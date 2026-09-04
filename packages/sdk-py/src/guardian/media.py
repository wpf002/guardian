"""Client-side enforcement of rule 1.

The event type has no field for bytes, but a customer can still put a data URI
in `text`, so this walks the values as well as the shape. Same two patterns as
`assertNoBytes` in packages/sdk-ts/src/index.ts and the same walk order, so a
payload refused by one SDK is refused by the other.

Guardian accepts a sha256 and the operator's own scanner verdict. Nothing else
about a piece of media ever enters the process.
"""

from __future__ import annotations

import re
from typing import Any, Mapping, Sequence

from .errors import GuardianMediaError

__all__ = ["DATA_URI", "BASE64_BLOB", "assert_no_bytes"]

DATA_URI = re.compile(r"^data:(image|video|application/octet-stream)", re.IGNORECASE)

# A long run of base64 characters is a payload, whatever field it is hiding in.
BASE64_BLOB = re.compile(r"[A-Za-z0-9+/]{512,}={0,2}")


def _as_plain(value: Any) -> Any:
    """Unwrap a pydantic model so the walk sees the same shape the wire will."""
    dump = getattr(value, "model_dump", None)
    if callable(dump):
        return dump(by_alias=True, mode="json")
    return value


def assert_no_bytes(event: Any, index: int = 0) -> None:
    """Raise GuardianMediaError if anything in `event` looks like media bytes.

    The walk is cycle safe. A node that has already been visited is skipped, so
    a self-referential object terminates instead of recursing forever.

    `seen` holds the nodes themselves rather than a set of `id()` values, and
    that is load bearing. `_as_plain` builds a throwaway dict for each pydantic
    sub-model; a set of ids keeps no reference to it, so CPython frees it when
    the walk frame returns and hands the same address to the next sibling's
    dump. That sibling's id is then already in the set and its entire subtree is
    skipped without being scanned. A payload of `{"a": DeviceHints(...),
    "b": DeviceHints(device_id_hash=<data uri>)}` came back clean that way,
    while the same value alone was refused. The TypeScript twin holds live
    references in a Set, so it never had the problem, and this module's contract
    is that a payload one SDK refuses the other refuses too.
    """
    seen: list[Any] = []

    def walk(node: Any, path: str) -> None:
        if isinstance(node, str):
            if DATA_URI.match(node.strip()):
                raise GuardianMediaError(
                    f"event {index} at {path} carries a data URI. Guardian accepts a "
                    "sha256 hash and your own scanner's verdict, never bytes."
                )
            if BASE64_BLOB.search(node):
                raise GuardianMediaError(
                    f"event {index} at {path} carries a long base64 run. "
                    "Send media.sha256 instead."
                )
            return

        if isinstance(node, (bytes, bytearray, memoryview)):
            raise GuardianMediaError(
                f"event {index} at {path} carries a raw byte string. Guardian accepts "
                "a sha256 hash and your own scanner's verdict, never bytes."
            )

        if node is None or isinstance(node, (bool, int, float)):
            return

        node = _as_plain(node)
        if isinstance(node, (str, bytes, bytearray, memoryview)) or node is None:
            walk(node, path)
            return

        if any(node is visited for visited in seen):
            return
        seen.append(node)

        if isinstance(node, Mapping):
            for key, value in node.items():
                walk(value, f"{path}.{key}")
            return

        if isinstance(node, (Sequence, set, frozenset)):
            for i, value in enumerate(node):
                walk(value, f"{path}[{i}]")
            return

        attrs = getattr(node, "__dict__", None)
        if isinstance(attrs, Mapping):
            for key, value in attrs.items():
                walk(value, f"{path}.{key}")

    walk(event, "$")
