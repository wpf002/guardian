"""Webhook verification.

Same cases as the webhook block in packages/sdk-ts/test/sdk.test.ts, plus the
replay window and the case-insensitive header lookup that a real WSGI or ASGI
framework makes necessary.
"""

from __future__ import annotations

import json
import time

import pytest

from conftest import client_with
from guardian import GuardianConfigError, GuardianSignatureError, sign_payload

PAYLOAD = {
    "event": "tier.assigned",
    "customerId": "cus_1",
    "actorUid": "a",
    "targetUid": "b",
    "tier": "T2",
    "rationale": ["Supervision probing followed by a migration ask."],
    "criticalSignals": [],
    "versions": {
        "modelVersion": "rules-v2",
        "lexiconVersion": "v2",
        "fusionVersion": "rules-v2",
    },
    "scoredAt": "2026-09-02T12:00:00.000Z",
}


def signed(raw: str, secret: str = "whsec_1", stamp: int | None = None):
    stamp = int(time.time()) if stamp is None else stamp
    return {
        "x-guardian-timestamp": str(stamp),
        "x-guardian-signature": sign_payload(raw, secret, stamp),
    }


def test_accepts_a_correctly_signed_webhook():
    client, _ = client_with({})
    raw = json.dumps(PAYLOAD)
    parsed = client.verify_webhook(raw, signed(raw))
    assert parsed.tier.value == "T2"
    assert parsed.versions.fusion_version == "rules-v2"


def test_accepts_a_bytes_body():
    client, _ = client_with({})
    raw = json.dumps(PAYLOAD)
    parsed = client.verify_webhook(raw.encode("utf-8"), signed(raw))
    assert parsed.customer_id == "cus_1"


def test_header_lookup_is_case_insensitive():
    client, _ = client_with({})
    raw = json.dumps(PAYLOAD)
    headers = {k.title(): v for k, v in signed(raw).items()}
    assert client.verify_webhook(raw, headers).tier.value == "T2"


def test_throws_when_the_body_was_changed_after_signing():
    client, _ = client_with({})
    raw = json.dumps(PAYLOAD)
    headers = signed(raw)
    tampered = json.dumps({**PAYLOAD, "tier": "T3"})
    with pytest.raises(GuardianSignatureError) as caught:
        client.verify_webhook(tampered, headers)
    assert "bad_signature" in str(caught.value)


def test_throws_when_the_headers_are_missing():
    client, _ = client_with({})
    with pytest.raises(GuardianSignatureError) as caught:
        client.verify_webhook("{}", {})
    assert "missing signature headers" in str(caught.value)


def test_throws_when_the_timestamp_is_outside_the_replay_window():
    client, _ = client_with({})
    raw = json.dumps(PAYLOAD)
    old = int(time.time()) - 400
    with pytest.raises(GuardianSignatureError) as caught:
        client.verify_webhook(raw, signed(raw, stamp=old))
    assert "stale" in str(caught.value)


def test_throws_when_the_timestamp_is_not_a_number():
    client, _ = client_with({})
    raw = json.dumps(PAYLOAD)
    headers = signed(raw)
    headers["x-guardian-timestamp"] = "not-a-number"
    with pytest.raises(GuardianSignatureError):
        client.verify_webhook(raw, headers)


def test_throws_without_a_configured_secret():
    client, _ = client_with({}, secret=None)
    with pytest.raises(GuardianConfigError):
        client.verify_webhook("{}", {})


def test_unknown_payload_fields_are_ignored_not_refused():
    client, _ = client_with({})
    raw = json.dumps({**PAYLOAD, "somethingNew": 1})
    assert client.verify_webhook(raw, signed(raw)).tier.value == "T2"
