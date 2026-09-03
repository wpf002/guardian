"""Classifiers.

Two of them in phase 1, and both are pluggable:

  * PII / off-platform migration. The real one is Roblox PII Classifier v2
    (189 languages, F1 90.5, weights on Hugging Face). It loads lazily and only
    when transformers and the weights are present, so a developer without a GPU
    or a model cache still gets a running service. Until it loads, a rule
    fallback runs and the response says so through `model_version`.

  * Stage classifier. Phase 2. The interface exists here so the scorer's call
    site does not change when the fine-tuned encoder lands; today it returns a
    flat distribution and an explicit `loaded: false`.

Nothing here downloads a dataset. Training data selection is a deliberate act
recorded in DESIGN.md section 12, not something a service does at import time.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

from .versions import PII_MODEL_ID, RULES_VERSION, STAGE_MODEL_ID, ModelVersion

STAGES = ("none", "contact", "trust", "probe", "migrate", "sexualize", "coerce")

_PLATFORMS = (
    "snapchat", "snap", "discord", "telegram", "kik", "whatsapp",
    "instagram", "insta", "signal", "wickr", "session", "omegle",
)
_MOVE = (
    "add me", "dm me", "pm me", "message me", "talk to me on", "move to",
    "my user is", "my username is", "whats your", "what's your", "add my",
)
_HANDLE = re.compile(r"@[a-z0-9._]{3,32}|\b[a-z0-9_.]{2,32}#\d{4}\b", re.I)


@dataclass
class PiiResult:
    """Probability that the message is an off-platform migration or PII ask."""

    score: float
    matched: list[str] = field(default_factory=list)
    model_version: str = RULES_VERSION


class PiiMigrationClassifier:
    """Roblox PII classifier v2 with a rule fallback.

    Set GUARDIAN_PII_MODEL to a local path or a Hub id to load real weights.
    With no model present the fallback runs, and `version.loaded` stays False so
    every score row records that a rule produced it rather than a model.
    """

    def __init__(self, model_id: str | None = None) -> None:
        self.model_id = model_id or os.environ.get("GUARDIAN_PII_MODEL") or PII_MODEL_ID
        self._pipeline = None
        self.version = ModelVersion(name=RULES_VERSION, loaded=False)
        self._tried = False

    def _load(self) -> None:
        if self._tried:
            return
        self._tried = True
        if os.environ.get("GUARDIAN_PII_MODEL") is None:
            # No explicit opt-in means no network call and no surprise download.
            return
        try:
            from transformers import pipeline  # type: ignore[import-not-found]

            self._pipeline = pipeline("text-classification", model=self.model_id)
            self.version = ModelVersion(name=self.model_id, revision="local", loaded=True)
        except Exception:  # pragma: no cover - depends on the host's model cache
            self._pipeline = None

    def score(self, text: str) -> PiiResult:
        self._load()
        if self._pipeline is not None:  # pragma: no cover - needs weights
            output = self._pipeline(text[:512])[0]
            score = float(output["score"]) if output["label"].lower() != "safe" else 0.0
            return PiiResult(score=score, matched=[output["label"]], model_version=str(self.version))
        return self._fallback(text)

    @staticmethod
    def _fallback(text: str) -> PiiResult:
        lowered = text.lower()
        compact = re.sub(r"[^a-z0-9]", "", lowered)
        matched: list[str] = []

        platform = next(
            (p for p in _PLATFORMS if p in lowered or (len(p) >= 4 and p in compact)),
            None,
        )
        if platform:
            matched.append(platform)
        move = next((m for m in _MOVE if m in lowered), None)
        if move:
            matched.append(move)
        handle = _HANDLE.search(text)
        if handle:
            matched.append("handle")

        # A named platform plus an ask is the concrete handoff. Either alone is
        # weaker, because kids talk about apps constantly.
        if platform and (move or handle):
            score = 0.9
        elif platform and handle:
            score = 0.8
        elif move and handle:
            score = 0.6
        elif platform or move:
            score = 0.35
        else:
            score = 0.02

        return PiiResult(score=score, matched=matched, model_version=RULES_VERSION)


@dataclass
class StageResult:
    probs: dict[str, float]
    model_version: str
    loaded: bool


class StageClassifier:
    """Phase 2. The fine-tuned encoder over the six-stage ladder.

    DESIGN.md section 6.1: a small encoder emitting a distribution over
    {none, contact, trust, probe, migrate, sexualize, coerce}, target F1 at or
    above 0.85 on held-out PANC plus a hand-labeled modern set. Until it exists,
    this returns an explicit unloaded result so the scorer knows to fall back to
    its own rules rather than trusting a flat distribution as a real answer.
    """

    def __init__(self, model_id: str | None = None) -> None:
        self.model_id = model_id or os.environ.get("GUARDIAN_STAGE_MODEL") or STAGE_MODEL_ID
        self.version = ModelVersion(name=self.model_id, loaded=False)

    def score(self, text: str) -> StageResult:  # noqa: ARG002
        return StageResult(
            probs={stage: (1.0 if stage == "none" else 0.0) for stage in STAGES},
            model_version=str(self.version),
            loaded=False,
        )
