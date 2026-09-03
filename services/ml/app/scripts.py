"""MinHash index over the sextortion script corpus.

Mirrors the TypeScript implementation in apps/scorer/src/detectors/minhash.ts
so a signature computed on either side means the same thing. Financial
sextortion is templated and crews paste whole scripts, so near-duplicate
matching catches what exact phrase matching misses after a one-word edit.

The corpus is offender threat text only. No victim content, no imagery, and
nothing that could contain CSAM (CLAUDE.md, external models and data).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

# Universal hashing over a 31-bit field, coefficients under 2^20. Matches the
# TypeScript index exactly so a signature means the same thing on both sides.
PRIME = 2147483647
COEFF_MASK = (1 << 20) - 1
MAX_HASH = PRIME

# The corpus is versioned alongside the lexicon in packages/schema.
CORPUS_DIR = Path(__file__).resolve().parents[3] / "packages" / "schema" / "corpus"


@dataclass(frozen=True)
class ScriptMatch:
    id: str
    label: str
    similarity: float


def _shingles(text: str, size: int) -> set[str]:
    cleaned = " ".join(text.split())
    if not cleaned:
        return set()
    if len(cleaned) <= size:
        return {cleaned}
    return {cleaned[i : i + size] for i in range(len(cleaned) - size + 1)}


def _shingle_hash(shingle: str) -> int:
    """FNV-1a over UTF-8 bytes, matching the TypeScript index byte for byte."""
    h = 0x811C9DC5
    for byte in shingle.encode():
        h ^= byte
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h % PRIME


def _permutations(num_perm: int) -> list[tuple[int, int]]:
    out = []
    for i in range(num_perm):
        digest = hashlib.sha256(f"guardian-minhash-{i}".encode()).digest()
        a = (int.from_bytes(digest[0:4], "big") & COEFF_MASK) + 1
        b = int.from_bytes(digest[4:8], "big") & COEFF_MASK
        out.append((a, b))
    return out


class ScriptIndex:
    def __init__(self, num_perm: int = 128, shingle_size: int = 5, bands: int = 32) -> None:
        if num_perm % bands:
            raise ValueError("num_perm must be divisible by bands")
        self.num_perm = num_perm
        self.shingle_size = shingle_size
        self.bands = bands
        self.rows = num_perm // bands
        self._perms = _permutations(num_perm)
        self._entries: dict[str, tuple[str, list[int]]] = {}
        self._buckets: dict[str, set[str]] = {}

    def signature(self, text: str) -> list[int]:
        sig = [MAX_HASH] * self.num_perm
        grams = _shingles(text, self.shingle_size)
        if not grams:
            return sig
        for gram in grams:
            h = _shingle_hash(gram)
            for i, (a, b) in enumerate(self._perms):
                value = (a * h + b) % PRIME
                if value < sig[i]:
                    sig[i] = value
        return sig

    def add(self, script_id: str, label: str, text: str) -> None:
        sig = self.signature(text)
        self._entries[script_id] = (label, sig)
        for key in self._band_keys(sig):
            self._buckets.setdefault(key, set()).add(script_id)

    def _band_keys(self, sig: list[int]) -> list[str]:
        keys = []
        for band in range(self.bands):
            chunk = sig[band * self.rows : (band + 1) * self.rows]
            keys.append(f"{band}:{','.join(map(str, chunk))}")
        return keys

    def query(self, text: str, threshold: float = 0.35) -> ScriptMatch | None:
        sig = self.signature(text)
        candidates: set[str] = set()
        for key in self._band_keys(sig):
            candidates |= self._buckets.get(key, set())

        best: ScriptMatch | None = None
        for script_id in candidates:
            label, other = self._entries[script_id]
            similarity = jaccard(sig, other)
            if similarity >= threshold and (best is None or similarity > best.similarity):
                best = ScriptMatch(id=script_id, label=label, similarity=similarity)
        return best

    def __len__(self) -> int:
        return len(self._entries)


def jaccard(a: list[int], b: list[int]) -> float:
    if len(a) != len(b):
        raise ValueError("signature length mismatch")
    return sum(1 for x, y in zip(a, b) if x == y) / len(a)


def load_index(version: str = "sextortion-v1") -> ScriptIndex:
    path = CORPUS_DIR / f"{version}.json"
    corpus = json.loads(path.read_text())
    index = ScriptIndex()
    for script in corpus["scripts"]:
        index.add(script["id"], script["label"], script["text"])
    return index
