"""Guardian Python SDK.

The Python half of the customer surface. It matches packages/sdk-ts feature for
feature: the same event schema, the same HMAC construction over timestamp and
body, the same replay window, and the same client-side refusal of media bytes.
A signature written by either SDK verifies on the same edge.

Guardian emits risk tiers and evidence bundles for human review. Tier T3 comes
only from a human reviewer, never from a model.
"""

from __future__ import annotations

from .client import (
    DEFAULT_BASE_URL,
    DEFAULT_TIMEOUT_SECONDS,
    GuardianClient,
    RejectedEvent,
    SendResult,
)
from .errors import (
    GuardianApiError,
    GuardianConfigError,
    GuardianError,
    GuardianMediaError,
    GuardianSignatureError,
    GuardianTimeoutError,
)
from .media import assert_no_bytes
from .models import (
    AGE_BANDS,
    MAX_EVENT_CLOCK_SKEW_MS,
    SIGNALS,
    TIERS,
    ActorRole,
    AgeBand,
    AgeBandProvenance,
    ChannelVisibility,
    DeviceHints,
    InboundEvent,
    KnownCsamVerdict,
    MediaKind,
    MediaRef,
    Provenance,
    SignalKind,
    Surface,
    Tier,
    Versions,
    WebhookPayload,
)
from .signing import (
    DEFAULT_TOLERANCE_SECONDS,
    SignatureVerdict,
    sign_payload,
    verify_signature,
)

__version__ = "0.0.1"

__all__ = [
    "__version__",
    "DEFAULT_BASE_URL",
    "DEFAULT_TIMEOUT_SECONDS",
    "DEFAULT_TOLERANCE_SECONDS",
    "MAX_EVENT_CLOCK_SKEW_MS",
    "AGE_BANDS",
    "TIERS",
    "SIGNALS",
    "GuardianClient",
    "SendResult",
    "RejectedEvent",
    "GuardianError",
    "GuardianConfigError",
    "GuardianMediaError",
    "GuardianApiError",
    "GuardianTimeoutError",
    "GuardianSignatureError",
    "assert_no_bytes",
    "sign_payload",
    "verify_signature",
    "SignatureVerdict",
    "InboundEvent",
    "MediaRef",
    "DeviceHints",
    "Provenance",
    "Versions",
    "WebhookPayload",
    "AgeBand",
    "AgeBandProvenance",
    "ActorRole",
    "ChannelVisibility",
    "KnownCsamVerdict",
    "MediaKind",
    "SignalKind",
    "Surface",
    "Tier",
]
