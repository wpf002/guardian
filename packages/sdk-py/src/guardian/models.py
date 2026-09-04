"""Pydantic mirrors of the canonical schema.

These follow packages/schema/src/types.ts field for field. The wire format is
camelCase because that is what the ingest edge validates, so every model
serializes by alias. Snake case is accepted on the way in for callers who would
rather write Python.

Two behaviours are load bearing rather than stylistic:

- `extra="forbid"` on the inbound event, matching zod's `.strict()`. A customer
  cannot smuggle an `image_bytes` field past the model and have it forwarded.
- Age bands, never birthdates (rule 9). Six real bands matching Roblox's scheme
  plus UNKNOWN, and nothing in this module accepts a date of birth.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

__all__ = [
    "AGE_BANDS",
    "TIERS",
    "SIGNALS",
    "MAX_EVENT_CLOCK_SKEW_MS",
    "AgeBand",
    "Tier",
    "SignalKind",
    "Surface",
    "ActorRole",
    "ChannelVisibility",
    "AgeBandProvenance",
    "KnownCsamVerdict",
    "MediaKind",
    "GuardianModel",
    "Provenance",
    "MediaRef",
    "DeviceHints",
    "InboundEvent",
    "Versions",
    "WebhookPayload",
]


class AgeBand(str, Enum):
    """Six bands matching Roblox's chat grouping, plus UNKNOWN. Rule 9."""

    UNDER_9 = "UNDER_9"
    A9_12 = "A9_12"
    A13_15 = "A13_15"
    A16_17 = "A16_17"
    A18_20 = "A18_20"
    A21_PLUS = "A21_PLUS"
    UNKNOWN = "UNKNOWN"


AGE_BANDS: tuple[str, ...] = tuple(band.value for band in AgeBand)


class Tier(str, Enum):
    """T3 comes only from a human reviewer. The model tops out at T2 (rule 6)."""

    T0 = "T0"
    T1 = "T1"
    T2 = "T2"
    T3 = "T3"


TIERS: tuple[str, ...] = tuple(tier.value for tier in Tier)


class SignalKind(str, Enum):
    supervision_probe = "supervision_probe"
    off_platform_migration = "off_platform_migration"
    secrecy_instruction = "secrecy_instruction"
    economic_bait = "economic_bait"
    age_relationship_framing = "age_relationship_framing"
    image_solicitation = "image_solicitation"
    threat_template = "threat_template"
    payment_after_media = "payment_after_media"
    coercion_nonfinancial = "coercion_nonfinancial"
    meetup_logistics = "meetup_logistics"
    actor_fanout = "actor_fanout"
    target_fanin = "target_fanin"
    new_account_burst = "new_account_burst"
    alt_cluster = "alt_cluster"
    skew_drift = "skew_drift"
    known_csam_hash = "known_csam_hash"


SIGNALS: tuple[str, ...] = tuple(signal.value for signal in SignalKind)


class Surface(str, Enum):
    discord = "discord"
    platform_sdk = "platform_sdk"
    parent_app = "parent_app"
    investigator = "investigator"


class ActorRole(str, Enum):
    member = "member"
    moderator = "moderator"
    trusted_adult = "trusted_adult"
    unknown = "unknown"


class ChannelVisibility(str, Enum):
    public = "public"
    private = "private"
    group = "group"


class AgeBandProvenance(str, Enum):
    facial_estimate = "facial_estimate"
    government_id = "government_id"
    os_bracket = "os_bracket"
    server_role = "server_role"
    platform_default = "platform_default"
    customer_declared = "customer_declared"
    unknown = "unknown"


class KnownCsamVerdict(str, Enum):
    """The operator's own scanner verdict. Guardian never runs one on bytes."""

    match = "match"
    no_match = "no_match"
    not_run = "not_run"


class MediaKind(str, Enum):
    image = "image"
    video = "video"
    unknown = "unknown"


class GuardianModel(BaseModel):
    """Base config. camelCase on the wire, snake case accepted on the way in,
    unknown fields refused."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        use_enum_values=False,
        protected_namespaces=(),
        str_strip_whitespace=False,
    )

    def to_wire(self) -> dict[str, Any]:
        """The exact JSON-ready shape the ingest edge validates."""
        return self.model_dump(by_alias=True, exclude_none=True, mode="json")


class Provenance(GuardianModel):
    """Where an event came from. Travels with the evidence bundle."""

    surface: Surface
    source_id: str = Field(min_length=1, max_length=128)
    # Set by the ingest edge, not the customer.
    received_at: Optional[datetime] = None


class MediaRef(GuardianModel):
    """Media is hash-only (rule 1).

    A digest and the operator's own verdict. There is no field for bytes, and
    the edge rejects any request that tries to smuggle them in.
    """

    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    known_csam_verdict: KnownCsamVerdict = KnownCsamVerdict.not_run
    kind: MediaKind = MediaKind.unknown


class DeviceHints(GuardianModel):
    """Identifiers for alt-account clustering. Hashed at the edge (rule 8)."""

    device_id_hash: Optional[str] = Field(default=None, max_length=128)
    ip_hash: Optional[str] = Field(default=None, max_length=128)


# How far ahead of the receiving clock an event timestamp may sit. Same value as
# MAX_EVENT_CLOCK_SKEW_MS in packages/schema/src/types.ts.
MAX_EVENT_CLOCK_SKEW_MS = 5 * 60_000


def _as_utc(value: datetime) -> datetime:
    """A naive timestamp is read as UTC, which is how the wire format reads."""
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


class InboundEvent(GuardianModel):
    """The canonical Event as a customer submits it.

    Uids here are the customer's own user ids. The ingest edge replaces them
    with per-customer salted hashes before anything is stored or queued
    (rule 8), so nothing joins across customers.
    """

    external_id: str = Field(min_length=1, max_length=128)
    actor_uid: str = Field(min_length=1, max_length=256)
    target_uid: Optional[str] = Field(default=None, min_length=1, max_length=256)
    channel: str = Field(min_length=1, max_length=128)
    ts: datetime
    text: Optional[str] = Field(default=None, max_length=8000)
    media: Optional[MediaRef] = None
    actor_band: AgeBand = AgeBand.UNKNOWN
    target_band: AgeBand = AgeBand.UNKNOWN
    # How the band was arrived at, and how sure the source was. Compliance
    # evidence, not metadata. Absent confidence is not zero confidence.
    actor_band_confidence: Optional[float] = Field(default=None, ge=0, le=1)
    actor_band_provenance: Optional[AgeBandProvenance] = None
    target_band_confidence: Optional[float] = Field(default=None, ge=0, le=1)
    target_band_provenance: Optional[AgeBandProvenance] = None
    # Absent is read as private by the scorer, so the stricter rule applies by
    # default.
    channel_visibility: Optional[ChannelVisibility] = None
    actor_role: ActorRole = ActorRole.unknown
    actor_account_age_hours: Optional[float] = Field(default=None, ge=0)
    device_hints: Optional[DeviceHints] = None
    provenance: Provenance

    @field_validator("ts")
    @classmethod
    def _reject_far_future(cls, value: datetime) -> datetime:
        limit_ms = time.time() * 1000 + MAX_EVENT_CLOCK_SKEW_MS
        if _as_utc(value).timestamp() * 1000 > limit_ms:
            minutes = MAX_EVENT_CLOCK_SKEW_MS // 60_000
            raise ValueError(f"ts is more than {minutes} minutes in the future")
        return value


class Versions(GuardianModel):
    """Version triple recorded on every score row."""

    model_version: str
    lexicon_version: str
    fusion_version: str


class WebhookPayload(BaseModel):
    """What the customer receives on their webhook.

    A tier and the reasons for it. `rationale` describes behaviour recorded in
    the traffic, never a claim about a person (rule 5). Unknown fields are
    ignored rather than refused, matching the zod object on the sending side,
    so a newer edge can add a field without breaking an older SDK.
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="ignore",
        protected_namespaces=(),
    )

    event: str = "tier.assigned"
    customer_id: str
    actor_uid: str
    target_uid: str
    tier: Tier
    rationale: list[str] = Field(default_factory=list)
    critical_signals: list[SignalKind] = Field(default_factory=list)
    versions: Versions
    scored_at: datetime

    @field_validator("event")
    @classmethod
    def _known_event(cls, value: str) -> str:
        if value != "tier.assigned":
            raise ValueError("event must be tier.assigned")
        return value
