"""Client-side rule 1.

Same cases as the media refusal block in packages/sdk-ts/test/sdk.test.ts.
"""

from __future__ import annotations

from typing import Any

import pytest

from conftest import client_with
from guardian import GuardianMediaError, assert_no_bytes


def test_refuses_a_data_uri_before_the_request_leaves_the_process(event):
    client, recorder = client_with({"accepted": 0, "rejected": []})
    with pytest.raises(GuardianMediaError):
        client.send({**event, "text": "data:image/png;base64,iVBORw0KGgo="})
    assert not recorder.called


def test_refuses_a_long_base64_run():
    with pytest.raises(GuardianMediaError):
        assert_no_bytes({"text": "A" * 600})


def test_refuses_an_octet_stream_data_uri():
    with pytest.raises(GuardianMediaError):
        assert_no_bytes({"text": "data:application/octet-stream;base64,AAAA"})


def test_refuses_a_data_uri_with_leading_whitespace():
    with pytest.raises(GuardianMediaError):
        assert_no_bytes({"text": "   data:video/mp4;base64,AAAA"})


def test_refuses_a_raw_byte_string():
    with pytest.raises(GuardianMediaError):
        assert_no_bytes({"attachment": b"\x89PNG\r\n\x1a\n"})


def test_allows_a_sha256_hash():
    assert_no_bytes({"media": {"sha256": "a" * 64}})


def test_does_not_loop_on_a_circular_object():
    node: dict[str, Any] = {"a": 1}
    node["self"] = node
    assert_no_bytes(node)


def test_finds_bytes_nested_in_a_list():
    with pytest.raises(GuardianMediaError) as caught:
        assert_no_bytes({"items": [{"ok": "fine"}, {"blob": "A" * 520}]})
    assert "items[1].blob" in str(caught.value)


def test_names_the_event_index_in_a_batch(event):
    client, recorder = client_with({"accepted": 0, "rejected": []})
    with pytest.raises(GuardianMediaError) as caught:
        client.send_batch([event, {**event, "text": "data:image/png;base64,AA=="}])
    assert "event 1" in str(caught.value)
    assert not recorder.called


def test_scans_a_sibling_model_rather_than_skipping_it():
    """Two pydantic models side by side in a dict.

    The cycle guard used to hold ``id()`` values. ``_as_plain`` builds a
    throwaway dict per sub-model, a set of ids keeps no reference to it, and
    CPython hands the freed address to the next sibling's dump; that sibling's
    id was then already in the set and its whole subtree was skipped unscanned.
    The value below came back clean while the same dirty model on its own was
    refused, which broke this module's contract that a payload one SDK refuses
    the other refuses too.
    """
    from guardian.models import DeviceHints, Provenance

    with pytest.raises(GuardianMediaError):
        assert_no_bytes(
            {
                "a": DeviceHints(device_id_hash="clean"),
                "b": DeviceHints(device_id_hash="data:image/png;base64,AAAA"),
            }
        )


def test_scans_every_sub_model_of_a_readme_shaped_event():
    """The shape the README's snake-case-in design invites: a dict of models."""
    from guardian.models import DeviceHints, MediaRef, Provenance

    with pytest.raises(GuardianMediaError):
        assert_no_bytes(
            {
                "text": "hey",
                "media": MediaRef(sha256="a" * 64),
                "provenance": Provenance(surface="platform_sdk", source_id="src_1"),
                "device_hints": DeviceHints(device_id_hash="data:image/png;base64,AAAA"),
            }
        )


def test_still_terminates_on_a_self_referential_object():
    node: dict[str, Any] = {"text": "hey"}
    node["self"] = node
    assert_no_bytes(node)
