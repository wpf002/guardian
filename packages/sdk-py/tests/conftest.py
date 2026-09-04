from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from guardian import GuardianClient

# The same fixture event as packages/sdk-ts/test/sdk.test.ts, so a behaviour
# difference between the two SDKs shows up as a failing test rather than as a
# customer integration that works in one language and not the other.
EVENT: dict[str, Any] = {
    "externalId": "m1",
    "actorUid": "u1",
    "targetUid": "u2",
    "channel": "general",
    "ts": "2026-09-02T12:00:00Z",
    "text": "hello",
    "actorBand": "A21_PLUS",
    "targetBand": "A9_12",
    "actorRole": "unknown",
    "provenance": {"surface": "platform_sdk", "sourceId": "app-1"},
}


class Recorder:
    """Captures what the client actually put on the wire."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []

    @property
    def called(self) -> bool:
        return bool(self.requests)

    def headers(self, index: int = 0) -> httpx.Headers:
        return self.requests[index].headers

    def body(self, index: int = 0) -> Any:
        return json.loads(self.requests[index].content.decode("utf-8"))

    def raw_body(self, index: int = 0) -> str:
        return self.requests[index].content.decode("utf-8")


def client_with(
    response: Any, status: int = 202, secret: str | None = "whsec_1"
) -> tuple[GuardianClient, Recorder]:
    recorder = Recorder()

    def handler(request: httpx.Request) -> httpx.Response:
        recorder.requests.append(request)
        return httpx.Response(
            status, json=response, headers={"content-type": "application/json"}
        )

    client = GuardianClient(
        api_key="gk_1",
        webhook_secret=secret,
        base_url="https://ingest.example",
        transport=httpx.MockTransport(handler),
    )
    return client, recorder


@pytest.fixture
def event() -> dict[str, Any]:
    return json.loads(json.dumps(EVENT))
