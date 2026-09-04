"""Cross-SDK signature parity.

The expected hex below is a literal on purpose. It was produced by the same
construction as signPayload in packages/schema/src/ids.ts, HMAC-SHA256 over
"<timestamp>.<body>". If either side of the pair changes how it signs, this
test fails instead of a customer's webhook silently failing to verify.

Reproduce it with:

    node -e 'const {createHmac}=require("node:crypto");
    console.log(createHmac("sha256","whsec_parity_fixture")
      .update("1756814400." + process.argv[1]).digest("hex"))' "$BODY"
"""

from __future__ import annotations

import time

from guardian import sign_payload, verify_signature

SECRET = "whsec_parity_fixture"
BODY = (
    '{"externalId":"m1","actorUid":"u1","targetUid":"u2",'
    '"channel":"general","ts":"2026-09-02T12:00:00.000Z"}'
)
TIMESTAMP = 1756814400
EXPECTED = "f6fe26fda254f58f9535d802443a849b33e82dca580653be2bdce76b9c2ebe33"


def test_sign_payload_matches_the_typescript_sdk_byte_for_byte():
    assert sign_payload(BODY, SECRET, TIMESTAMP) == EXPECTED


def test_a_signature_from_either_sdk_verifies_here():
    verdict = verify_signature(
        BODY, SECRET, TIMESTAMP, EXPECTED, now=lambda: TIMESTAMP + 5
    )
    assert verdict.ok


def test_uppercase_hex_verifies():
    verdict = verify_signature(
        BODY, SECRET, TIMESTAMP, EXPECTED.upper(), now=lambda: TIMESTAMP
    )
    assert verdict.ok


def test_a_changed_body_does_not_verify():
    verdict = verify_signature(
        BODY + " ", SECRET, TIMESTAMP, EXPECTED, now=lambda: TIMESTAMP
    )
    assert not verdict.ok
    assert verdict.reason == "bad_signature"


def test_outside_the_replay_window_is_stale():
    verdict = verify_signature(
        BODY, SECRET, TIMESTAMP, EXPECTED, now=lambda: TIMESTAMP + 301
    )
    assert verdict.reason == "stale"


def test_inside_the_replay_window_is_accepted():
    verdict = verify_signature(
        BODY, SECRET, TIMESTAMP, EXPECTED, now=lambda: TIMESTAMP + 299
    )
    assert verdict.ok


def test_a_future_timestamp_outside_the_window_is_stale():
    verdict = verify_signature(
        BODY, SECRET, TIMESTAMP, EXPECTED, now=lambda: TIMESTAMP - 400
    )
    assert verdict.reason == "stale"


def test_a_signature_that_is_not_64_hex_characters_is_malformed():
    verdict = verify_signature(BODY, SECRET, TIMESTAMP, "nope", now=lambda: TIMESTAMP)
    assert verdict.reason == "malformed"


def test_a_non_numeric_timestamp_is_malformed():
    verdict = verify_signature(
        BODY, SECRET, float("nan"), EXPECTED, now=lambda: TIMESTAMP
    )
    assert verdict.reason == "malformed"


def test_the_default_clock_is_wall_time():
    now = int(time.time())
    signature = sign_payload(BODY, SECRET, now)
    assert verify_signature(BODY, SECRET, now, signature).ok
