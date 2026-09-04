"""HMAC signing and verification.

Byte for byte the same construction as `signPayload` and `verifySignature` in
packages/schema/src/ids.ts: HMAC-SHA256 over "<timestamp>.<body>" with the
shared secret, hex encoded lowercase. A signature produced by either SDK
verifies on the same edge, and the parity test pins the expected hex as a
literal so a change on either side breaks a test rather than a customer.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import time
from dataclasses import dataclass
from typing import Callable, Literal

__all__ = [
    "DEFAULT_TOLERANCE_SECONDS",
    "SignatureVerdict",
    "sign_payload",
    "verify_signature",
]

# Replay window in seconds. Same default as verifySignature in ids.ts.
DEFAULT_TOLERANCE_SECONDS = 300

_HEX_64 = re.compile(r"^[a-f0-9]{64}$", re.IGNORECASE)

FailureReason = Literal["stale", "bad_signature", "malformed"]


@dataclass(frozen=True)
class SignatureVerdict:
    """Result of a check. Carries a reason rather than raising, because the
    caller logs the reason as a customer-side fault."""

    ok: bool
    reason: FailureReason | None = None


def sign_payload(body: str, secret: str, timestamp: int | float) -> str:
    """Hex HMAC-SHA256 of "<timestamp>.<body>" keyed by the shared secret."""
    stamp: int | float = int(timestamp) if float(timestamp).is_integer() else timestamp
    message = f"{stamp}.{body}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def verify_signature(
    body: str,
    secret: str,
    timestamp: int | float,
    signature: str,
    *,
    tolerance_seconds: int = DEFAULT_TOLERANCE_SECONDS,
    now: Callable[[], float] | None = None,
) -> SignatureVerdict:
    """Constant-time check with a replay window.

    The order of the checks matches ids.ts: a non-numeric timestamp is
    malformed, a timestamp outside the window is stale, a signature that is not
    64 hex characters is malformed, and only then is the digest compared.
    """
    seconds = (now or time.time)()

    if timestamp is None or isinstance(timestamp, bool):
        return SignatureVerdict(False, "malformed")
    try:
        stamp = float(timestamp)
    except (TypeError, ValueError):
        return SignatureVerdict(False, "malformed")
    if stamp != stamp or stamp in (float("inf"), float("-inf")):
        return SignatureVerdict(False, "malformed")

    if abs(seconds - stamp) > tolerance_seconds:
        return SignatureVerdict(False, "stale")
    if not _HEX_64.match(signature or ""):
        return SignatureVerdict(False, "malformed")

    expected = sign_payload(body, secret, stamp)
    if hmac.compare_digest(expected, signature.lower()):
        return SignatureVerdict(True)
    return SignatureVerdict(False, "bad_signature")
