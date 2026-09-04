"""Typed exceptions.

Every failure a customer can hit has its own class, so a caller can tell a
refused payload from a bad key from a slow network without reading message
text. The names mirror packages/sdk-ts so a team running both SDKs learns one
vocabulary.
"""

from __future__ import annotations

from typing import Any

__all__ = [
    "GuardianError",
    "GuardianConfigError",
    "GuardianMediaError",
    "GuardianApiError",
    "GuardianTimeoutError",
    "GuardianSignatureError",
]


class GuardianError(Exception):
    """Base class for everything this SDK raises on purpose."""


class GuardianConfigError(GuardianError):
    """The client was asked to do something it was not configured for."""


class GuardianMediaError(GuardianError):
    """The payload carried bytes.

    Rule 1 in CLAUDE.md is 18 USC 2252/2252A: no code path may accept, store,
    download, fetch or log image or video bytes. The ingest edge refuses them
    too, but raising here means a customer finds out at their own call site
    rather than from a 422, and the bytes never leave their process.
    """


class GuardianApiError(GuardianError):
    """The ingest edge answered with a non-success status."""

    def __init__(self, message: str, status: int, body: Any) -> None:
        super().__init__(message)
        self.status = status
        self.body = body


class GuardianTimeoutError(GuardianError):
    """The request did not finish inside the configured timeout."""


class GuardianSignatureError(GuardianError):
    """A webhook did not verify.

    Raised rather than returned, so a customer cannot accidentally act on an
    unverified tier.
    """

    def __init__(self, message: str, reason: str | None = None) -> None:
        super().__init__(message)
        self.reason = reason
