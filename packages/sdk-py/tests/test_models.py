"""The event model mirrors inboundEventSchema in packages/schema/src/types.ts."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from guardian import AGE_BANDS, AgeBand, InboundEvent, MediaRef, Provenance


def test_there_are_six_age_bands_plus_unknown():
    real = [band for band in AGE_BANDS if band != "UNKNOWN"]
    assert len(real) == 6
    assert real == ["UNDER_9", "A9_12", "A13_15", "A16_17", "A18_20", "A21_PLUS"]


def test_the_model_has_no_field_for_a_birthdate():
    assert "birthdate" not in InboundEvent.model_fields
    assert "dob" not in InboundEvent.model_fields


def test_bands_default_to_unknown(event):
    stripped = {k: v for k, v in event.items() if not k.endswith("Band")}
    parsed = InboundEvent.model_validate(stripped)
    assert parsed.actor_band is AgeBand.UNKNOWN
    assert parsed.target_band is AgeBand.UNKNOWN


def test_an_unknown_band_is_refused(event):
    with pytest.raises(ValidationError):
        InboundEvent.model_validate({**event, "actorBand": "A22_PLUS"})


def test_extra_fields_are_refused_so_bytes_cannot_be_smuggled(event):
    with pytest.raises(ValidationError) as caught:
        InboundEvent.model_validate({**event, "imageBytes": "AAAA"})
    assert "imageBytes" in str(caught.value)


def test_an_unknown_field_inside_media_is_refused():
    with pytest.raises(ValidationError):
        MediaRef.model_validate({"sha256": "a" * 64, "buffer": "AAAA"})


def test_media_ref_requires_lowercase_hex():
    with pytest.raises(ValidationError):
        MediaRef.model_validate({"sha256": "A" * 64})
    ref = MediaRef.model_validate({"sha256": "a" * 64})
    assert ref.known_csam_verdict.value == "not_run"
    assert ref.kind.value == "unknown"


def test_media_ref_has_no_field_for_bytes():
    assert set(MediaRef.model_fields) == {"sha256", "known_csam_verdict", "kind"}


def test_a_far_future_timestamp_is_refused(event):
    far = datetime.now(timezone.utc) + timedelta(minutes=30)
    with pytest.raises(ValidationError) as caught:
        InboundEvent.model_validate({**event, "ts": far.isoformat()})
    assert "in the future" in str(caught.value)


def test_a_small_clock_skew_is_allowed(event):
    near = datetime.now(timezone.utc) + timedelta(minutes=2)
    assert InboundEvent.model_validate({**event, "ts": near.isoformat()})


def test_a_backdated_timestamp_is_allowed(event):
    old = datetime.now(timezone.utc) - timedelta(days=400)
    assert InboundEvent.model_validate({**event, "ts": old.isoformat()})


def test_text_over_the_cap_is_refused(event):
    with pytest.raises(ValidationError):
        InboundEvent.model_validate({**event, "text": "a" * 8001})


def test_provenance_is_required(event):
    without = {k: v for k, v in event.items() if k != "provenance"}
    with pytest.raises(ValidationError):
        InboundEvent.model_validate(without)


def test_provenance_surface_enum():
    with pytest.raises(ValidationError):
        Provenance.model_validate({"surface": "sms", "sourceId": "app-1"})


def test_to_wire_uses_camel_case_and_drops_absent_fields(event):
    wire = InboundEvent.model_validate(event).to_wire()
    assert wire["externalId"] == "m1"
    assert wire["actorBand"] == "A21_PLUS"
    assert "media" not in wire
    assert "deviceHints" not in wire
    assert wire["provenance"]["sourceId"] == "app-1"
