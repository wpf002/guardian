# guardian-sdk

The Python half of the Guardian customer surface. It matches
[`packages/sdk-ts`](../sdk-ts) feature for feature: the same event schema, the
same HMAC construction over timestamp and body, the same replay window, and the
same client-side refusal of media bytes. A signature written by either SDK
verifies on the same edge, and a parity test pins the expected hex so a change
on either side breaks a test rather than a customer.

Runtime dependencies are `pydantic` and `httpx`. Nothing else.

## Install

```bash
uv pip install -e "packages/sdk-py[dev]"
```

## Send an event

```python
from guardian import GuardianClient

client = GuardianClient(api_key="gk_live_...", webhook_secret="whsec_...")
client.send({
    "externalId": "msg_8417",
    "actorUid": "u_1029",
    "targetUid": "u_4471",
    "channel": "general",
    "ts": "2026-09-04T18:22:11Z",
    "text": "what time do your parents get home",
    "actorBand": "A21_PLUS",
    "targetBand": "A9_12",
    "provenance": {"surface": "platform_sdk", "sourceId": "app-1"},
})
```

`send_batch` takes a list and posts it under an `events` key. Both return a
`SendResult` with `accepted` and a `rejected` list of `(index, error)`. A 207
means some items were taken and some were not, which is not an error.

Snake case works too, and the client converts to the camelCase wire format:

```python
from guardian import InboundEvent, Provenance, AgeBand

client.send(InboundEvent(
    external_id="msg_8417",
    actor_uid="u_1029",
    channel="general",
    ts="2026-09-04T18:22:11Z",
    actor_band=AgeBand.A21_PLUS,
    provenance=Provenance(surface="platform_sdk", source_id="app-1"),
))
```

## Verify the webhook

Guardian posts a tier to your endpoint. Verify before you act on it. The
signature check is constant time and rejects anything outside a 300 second
replay window.

```python
from guardian import GuardianClient, GuardianSignatureError

client = GuardianClient(api_key="gk_live_...", webhook_secret="whsec_...")

@app.post("/guardian/webhook")
async def hook(request):
    raw = await request.body()
    try:
        payload = client.verify_webhook(raw, request.headers)
    except GuardianSignatureError:
        return Response(status_code=401)
    # payload.tier is T0, T1, T2 or T3. payload.rationale describes the
    # behaviour recorded in the traffic.
    queue_for_review(payload)
```

`verify_webhook` raises rather than returning a boolean, so you cannot
accidentally act on an unverified tier.

## Media is hash-only

Guardian never accepts image or video bytes. There is no field for them, and
the client walks your payload before the request leaves your process:

```python
from guardian import GuardianMediaError

try:
    client.send({**event, "text": "data:image/png;base64,iVBORw0KGgo="})
except GuardianMediaError:
    ...  # nothing was sent
```

Send `media.sha256` and your own scanner's verdict instead:

```python
"media": {
    "sha256": "9f86d0818882...",   # 64 lowercase hex characters
    "knownCsamVerdict": "no_match",  # your PhotoDNA, Safer or CSAI result
    "kind": "image",
}
```

The walk catches data URIs, long base64 runs and raw byte strings anywhere in
the payload, at any depth, and terminates on self-referential objects. The
event model refuses unknown fields, so a stray `image_bytes` key fails
validation rather than being forwarded.

## Ages

Six bands matching Roblox's chat grouping, plus `UNKNOWN`. Never a birthdate.

`UNDER_9`, `A9_12`, `A13_15`, `A16_17`, `A18_20`, `A21_PLUS`

Each band can carry a confidence (0 to 1) and a provenance
(`facial_estimate`, `government_id`, `os_bracket`, `server_role`,
`platform_default`, `customer_declared`, `unknown`). Absent confidence means
the source published no calibrated number, which is not the same as a low one.

## What the tiers mean

| Tier | Meaning |
|---|---|
| T0 | nothing |
| T1 | watch, retained 30 days, no human sees it |
| T2 | human review queue within 4 hours |
| T3 | reviewer-confirmed, CyberTipline report and one-year preservation |

T3 comes only from a human reviewer. Guardian's models top out at T2, and a
tier describes behaviour recorded in a conversation, never a person.

## Exceptions

| Class | Raised when |
|---|---|
| `GuardianMediaError` | the payload carried bytes, and nothing was sent |
| `GuardianApiError` | the edge answered with a non-success status; carries `status` and `body` |
| `GuardianTimeoutError` | the request did not finish inside `timeout` (default 5 seconds) |
| `GuardianSignatureError` | a webhook did not verify; `reason` is `stale`, `bad_signature` or `malformed` |
| `GuardianConfigError` | the client was asked to do something it was not configured for |

All five inherit from `GuardianError`. Payload validation raises pydantic's
`ValidationError`.

## Tests

```bash
cd packages/sdk-py
uv venv --python 3.11
uv pip install -e ".[dev]"
uv run pytest -q
```

The suite mirrors `packages/sdk-ts/test/sdk.test.ts` case for case, so a
behaviour difference between the two SDKs shows up as a failing test.
