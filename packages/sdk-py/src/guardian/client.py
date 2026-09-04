"""The customer-facing client.

Two jobs, the same two as packages/sdk-ts: send events, and verify the webhook
that comes back. It refuses to send media bytes on the client side too, so a
customer finds out at their own call site rather than from a 422.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Sequence

import httpx

from .errors import (
    GuardianApiError,
    GuardianConfigError,
    GuardianSignatureError,
    GuardianTimeoutError,
)
from .media import assert_no_bytes
from .models import InboundEvent, WebhookPayload
from .signing import DEFAULT_TOLERANCE_SECONDS, sign_payload, verify_signature

__all__ = [
    "DEFAULT_BASE_URL",
    "DEFAULT_TIMEOUT_SECONDS",
    "RejectedEvent",
    "SendResult",
    "GuardianClient",
]

DEFAULT_BASE_URL = "http://localhost:3001"
# 5 seconds, matching the timeoutMs default in packages/sdk-ts.
DEFAULT_TIMEOUT_SECONDS = 5.0

EVENTS_PATH = "/v1/events"

KEY_HEADER = "x-guardian-key"
SIGNATURE_HEADER = "x-guardian-signature"
TIMESTAMP_HEADER = "x-guardian-timestamp"


@dataclass(frozen=True)
class RejectedEvent:
    """One item the edge would not take, and why. Never the offending value."""

    index: int
    error: str


@dataclass(frozen=True)
class SendResult:
    accepted: int = 0
    rejected: list[RejectedEvent] = field(default_factory=list)


def _to_send_result(body: Any) -> SendResult:
    if not isinstance(body, Mapping):
        return SendResult()
    rejected = body.get("rejected") or []
    items: list[RejectedEvent] = []
    if isinstance(rejected, Iterable) and not isinstance(rejected, (str, bytes)):
        for item in rejected:
            if isinstance(item, Mapping):
                items.append(
                    RejectedEvent(
                        index=int(item.get("index", 0)),
                        error=str(item.get("error", "")),
                    )
                )
    accepted = body.get("accepted") or 0
    return SendResult(accepted=int(accepted), rejected=items)


def _header(headers: Mapping[str, Any] | None, name: str) -> str | None:
    """Case-insensitive lookup. Real frameworks hand back mixed case."""
    if not headers:
        return None
    direct = headers.get(name)
    if direct is not None:
        return str(direct)
    lowered = name.lower()
    for key, value in headers.items():
        if isinstance(key, str) and key.lower() == lowered and value is not None:
            return str(value)
    return None


class GuardianClient:
    """Send events to the ingest edge and verify tier webhooks.

    Args:
        api_key: the per-customer key, sent as the x-guardian-key header.
        webhook_secret: shared secret. When set, every request is signed, and
            it is also what verify_webhook checks against.
        base_url: ingest origin.
        timeout: seconds before the request is abandoned.
        transport: an httpx transport, for tests.
        http_client: bring your own configured httpx.Client if you have one.
    """

    def __init__(
        self,
        api_key: str,
        *,
        webhook_secret: str | None = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        transport: httpx.BaseTransport | None = None,
        http_client: httpx.Client | None = None,
        tolerance_seconds: int = DEFAULT_TOLERANCE_SECONDS,
    ) -> None:
        self.api_key = api_key
        self.webhook_secret = webhook_secret
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.tolerance_seconds = tolerance_seconds
        self._owns_client = http_client is None
        self._client = http_client or httpx.Client(timeout=timeout, transport=transport)

    def __enter__(self) -> "GuardianClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def send(self, event: InboundEvent | Mapping[str, Any]) -> SendResult:
        """Send one event."""
        return self.send_batch([event])

    def send_batch(
        self, events: Sequence[InboundEvent | Mapping[str, Any]]
    ) -> SendResult:
        """Send a list of events under an `events` key.

        Every item is checked for bytes before it is validated, and both happen
        before anything leaves the process.
        """
        payloads: list[dict[str, Any]] = []
        for index, event in enumerate(events):
            assert_no_bytes(event, index)
            parsed = (
                event
                if isinstance(event, InboundEvent)
                else InboundEvent.model_validate(event)
            )
            payloads.append(parsed.to_wire())

        wire: Any = payloads[0] if len(payloads) == 1 else {"events": payloads}
        # Compact separators so the signed bytes match what JSON.stringify
        # produces on the TypeScript side.
        body = json.dumps(wire, separators=(",", ":"), ensure_ascii=False)

        headers = {
            "content-type": "application/json",
            KEY_HEADER: self.api_key,
        }
        if self.webhook_secret:
            stamp = int(time.time())
            headers[TIMESTAMP_HEADER] = str(stamp)
            headers[SIGNATURE_HEADER] = sign_payload(body, self.webhook_secret, stamp)

        try:
            response = self._client.post(
                f"{self.base_url}{EVENTS_PATH}",
                content=body.encode("utf-8"),
                headers=headers,
                timeout=self.timeout,
            )
        except httpx.TimeoutException as exc:
            raise GuardianTimeoutError(
                f"ingest did not answer within {self.timeout} seconds"
            ) from exc

        try:
            parsed_body: Any = response.json()
        except ValueError:
            parsed_body = {}

        if not response.is_success and response.status_code != 207:
            message = None
            if isinstance(parsed_body, Mapping):
                message = parsed_body.get("error")
            raise GuardianApiError(
                str(message or f"ingest returned {response.status_code}"),
                response.status_code,
                parsed_body,
            )

        return _to_send_result(parsed_body)

    def verify_webhook(
        self,
        raw_body: str | bytes,
        headers: Mapping[str, Any],
    ) -> WebhookPayload:
        """Verify an inbound webhook.

        Returns the parsed payload or raises, so a customer cannot accidentally
        act on an unverified tier. The comparison is constant time and the
        replay window is the same 300 seconds the edge uses.
        """
        secret = self.webhook_secret
        if not secret:
            raise GuardianConfigError(
                "webhook_secret is required to verify webhooks"
            )

        body = raw_body.decode("utf-8") if isinstance(raw_body, bytes) else raw_body

        signature = _header(headers, SIGNATURE_HEADER)
        timestamp = _header(headers, TIMESTAMP_HEADER)
        if not signature or not timestamp:
            raise GuardianSignatureError("missing signature headers", "malformed")

        try:
            stamp = float(timestamp)
        except ValueError:
            raise GuardianSignatureError(
                "webhook signature malformed", "malformed"
            ) from None

        verdict = verify_signature(
            body,
            secret,
            stamp,
            signature,
            tolerance_seconds=self.tolerance_seconds,
        )
        if not verdict.ok:
            raise GuardianSignatureError(
                f"webhook signature {verdict.reason}", verdict.reason
            )

        return WebhookPayload.model_validate(json.loads(body))
