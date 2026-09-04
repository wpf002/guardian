from __future__ import annotations

import re

import pytest

from conftest import client_with
from guardian import GuardianApiError, GuardianTimeoutError, InboundEvent

HEX_64 = re.compile(r"^[a-f0-9]{64}$")


def test_signs_the_request_when_a_secret_is_configured(event):
    client, recorder = client_with({"accepted": 1, "rejected": []})
    client.send(event)
    headers = recorder.headers()
    assert HEX_64.match(headers["x-guardian-signature"])
    assert headers["x-guardian-key"] == "gk_1"
    assert headers["x-guardian-timestamp"].isdigit()


def test_does_not_sign_when_no_secret_is_configured(event):
    client, recorder = client_with({"accepted": 1, "rejected": []}, secret=None)
    client.send(event)
    headers = recorder.headers()
    assert "x-guardian-signature" not in headers
    assert headers["x-guardian-key"] == "gk_1"


def test_sends_a_single_event_as_a_bare_object(event):
    client, recorder = client_with({"accepted": 1, "rejected": []})
    client.send(event)
    body = recorder.body()
    assert body["externalId"] == "m1"
    assert "events" not in body


def test_sends_a_batch_under_an_events_key(event):
    client, recorder = client_with({"accepted": 2, "rejected": []})
    client.send_batch([event, {**event, "externalId": "m2"}])
    body = recorder.body()
    assert len(body["events"]) == 2


def test_surfaces_a_207_as_accepted_plus_per_item_errors(event):
    client, _ = client_with(
        {"accepted": 1, "rejected": [{"index": 1, "error": "ts: bad"}]}, status=207
    )
    result = client.send_batch([event, event])
    assert result.accepted == 1
    assert len(result.rejected) == 1
    assert result.rejected[0].index == 1


def test_throws_on_an_api_error(event):
    client, _ = client_with({"error": "unknown api key"}, status=401)
    with pytest.raises(GuardianApiError) as caught:
        client.send(event)
    assert "unknown api key" in str(caught.value)
    assert caught.value.status == 401


def test_falls_back_to_the_status_when_the_body_has_no_error(event):
    client, _ = client_with({}, status=500)
    with pytest.raises(GuardianApiError) as caught:
        client.send(event)
    assert "ingest returned 500" in str(caught.value)


def test_a_timeout_raises_a_typed_error(event):
    import httpx

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    from guardian import GuardianClient

    client = GuardianClient(
        api_key="gk_1",
        base_url="https://ingest.example",
        timeout=0.01,
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(GuardianTimeoutError):
        client.send(event)


def test_accepts_a_model_as_well_as_a_dict(event):
    client, recorder = client_with({"accepted": 1, "rejected": []})
    client.send(InboundEvent.model_validate(event))
    assert recorder.body()["externalId"] == "m1"


def test_snake_case_kwargs_serialize_as_camel_case(event):
    client, recorder = client_with({"accepted": 1, "rejected": []})
    client.send(
        InboundEvent(
            external_id="m9",
            actor_uid="u1",
            channel="general",
            ts="2026-09-02T12:00:00Z",
            provenance={"surface": "platform_sdk", "source_id": "app-1"},
        )
    )
    body = recorder.body()
    assert body["externalId"] == "m9"
    assert body["provenance"]["sourceId"] == "app-1"


def test_body_is_compact_json_so_the_signed_bytes_match_the_ts_sdk(event):
    client, recorder = client_with({"accepted": 1, "rejected": []})
    client.send(event)
    raw = recorder.raw_body()
    assert ", " not in raw
    assert '": ' not in raw
