"""Classifiers.

Two of them in phase 1, and both are pluggable:

  * PII / off-platform migration. The real one is Roblox PII Classifier v2
    (189 languages, F1 90.5, weights on Hugging Face, Apache-2.0). It loads
    lazily and only when transformers and the weights are present, so a
    developer without a GPU or a model cache still gets a running service.
    Until it loads, a rule fallback runs and the response says so through
    `model_version`.

  * Stage classifier. Phase 2. The interface exists here so the scorer's call
    site does not change when the fine-tuned encoder lands; today it returns a
    flat distribution and an explicit `loaded: false`.

Nothing here downloads a dataset. Training data selection is a deliberate act
recorded in DESIGN.md section 12, not something a service does at import time.
Nothing here downloads weights either unless the operator opts in twice: once
by naming a model, once by allowing a fetch.
"""

from __future__ import annotations

import math
import os
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

from .versions import PII_MODEL_ID, RULES_VERSION, STAGE_MODEL_ID, ModelVersion

STAGES = ("none", "contact", "trust", "probe", "migrate", "sexualize", "coerce")

# ---------------------------------------------------------------------------
# Roblox PII Classifier v2 input contract
# ---------------------------------------------------------------------------
#
# Source: https://huggingface.co/Roblox/roblox-pii-classifier-v2
# Read 2026-09-04 from the model card (README.md), the repo's config.json and
# tokenizer_config.json, and the repo's own inference.py, which is where the
# byte-level constants below come from verbatim.
#
# The model takes ONE pre-formatted flat string. It is not JSON, and it is not
# the bare message. The string is:
#
#     INSTRUCTION_PREFIX + "\n\n" + " </s> ".join(f"{speaker}: {text}")
#
# The speaker under evaluation is always "t". Every other participant is
# anonymized to "s1", "s2", ... in order of first appearance, so the same
# conversation formats identically no matter what the platform calls people.
#
# Tokenization is XLM-RoBERTa SentencePiece at a fixed 512 tokens with
# padding="max_length", truncation=True and, critically, truncation_side="left",
# so when the history overflows the window the oldest turns are dropped and the
# latest target message survives. Getting that side wrong silently discards the
# message being scored.
#
# The head is multi-label: element-wise sigmoid over three logits in a fixed
# index order, each with its own published decision threshold. There is no
# softmax and no "safe" class, so a text-classification pipeline that takes
# argmax over labels reads this model wrong.
#
# Verified on 2026-09-04, constant by constant, against the model repo:
#   README.md            the instruction block, the " </s> " join, the t/s1/s2
#                        convention, 512 tokens, padding, truncation_side=left,
#                        and the three thresholds in the index order below.
#   inference.py         the same five string constants, character for
#                        character, plus the "\n\n" between prefix and turns.
#   config.json          id2label 0/1/2 in this order, num_labels 3,
#                        problem_type multi_label_classification,
#                        XLMRobertaForSequenceClassification.
#   tokenizer_config.json  XLMRobertaTokenizer, model_max_length 512, and
#                        sep_token "</s>", which is why the join uses it.
#
# What could not be verified without the weights: the numbers the model actually
# emits, and therefore the published F1. `test_pii_contract.py` pins the input
# string and the threshold arithmetic instead, which is the half a refactor can
# break silently.
#
# The license is Apache-2.0 (checked against the Hub API on 2026-09-04).

PII_INSTRUCTION_PREFIX = (
    "Instruct: In the following chat messages from target speaker t and possibly "
    "other speakers s1, s2, etc., detect abuse by speaker t.\nQuery:"
)
PII_INSTRUCTION_SEPARATOR = "\n\n"
PII_TURN_SEPARATOR = " </s> "
PII_TARGET_SPEAKER = "t"
PII_SPEAKER_TEXT_SEPARATOR = ": "
PII_MAX_LENGTH = 512
PII_TRUNCATION_SIDE = "left"
PII_PADDING = "max_length"

# Fixed index order. config.json id2label agrees: 0, 1, 2 in this order.
PII_LABELS: tuple[str, ...] = (
    "privacy_asking_for_pii",
    "privacy_giving_pii",
    "directing_users_off_platform",
)

# Published decision thresholds, one per label. Applied independently, because
# the head is multi-label.
PII_THRESHOLDS: dict[str, float] = {
    "privacy_asking_for_pii": 0.60,
    "privacy_giving_pii": 0.55,
    "directing_users_off_platform": 0.10,
}

# The label that maps onto DESIGN.md section 5's off-platform migration signal.
PII_MIGRATION_LABEL = "directing_users_off_platform"


@dataclass(frozen=True)
class PiiTurn:
    """One chat turn. `speaker` is the platform's own name for the speaker.

    The formatter anonymizes it. Use the literal "t" for the speaker being
    scored; every other name becomes s1, s2 and so on.
    """

    speaker: str
    text: str


def format_pii_input(value: str | Sequence[PiiTurn] | Sequence[dict[str, str]]) -> str:
    """Build the exact string Roblox PII v2 was trained on.

    A bare string is treated as a single turn from the target speaker, which is
    what the model repo's inference.py does for `--text`.

    This function is the contract. If it changes, the measured F1 no longer
    applies to anything Guardian scores, so a fixture pins its output byte for
    byte in tests/test_pii_contract.py.
    """
    turns = _coerce_turns(value)
    if not turns:
        raise ValueError("conversation must contain at least one turn")

    others: dict[str, str] = {}
    formatted: list[str] = []
    for turn in turns:
        if turn.speaker == PII_TARGET_SPEAKER:
            speaker = PII_TARGET_SPEAKER
        else:
            if turn.speaker not in others:
                others[turn.speaker] = f"s{len(others) + 1}"
            speaker = others[turn.speaker]
        formatted.append(f"{speaker}{PII_SPEAKER_TEXT_SEPARATOR}{turn.text}")

    return (
        PII_INSTRUCTION_PREFIX
        + PII_INSTRUCTION_SEPARATOR
        + PII_TURN_SEPARATOR.join(formatted)
    )


def _coerce_turns(
    value: str | Sequence[PiiTurn] | Sequence[dict[str, str]],
) -> list[PiiTurn]:
    if isinstance(value, str):
        return [PiiTurn(speaker=PII_TARGET_SPEAKER, text=value)]

    turns: list[PiiTurn] = []
    for index, turn in enumerate(value):
        if isinstance(turn, PiiTurn):
            candidate = turn
        elif isinstance(turn, dict):
            speaker = turn.get("speaker")
            text = turn.get("text")
            if not isinstance(speaker, str) or not speaker:
                raise ValueError(f"turn {index} has no speaker")
            if not isinstance(text, str):
                raise ValueError(f"turn {index} has non-string text")
            candidate = PiiTurn(speaker=speaker, text=text)
        else:
            raise TypeError(f"turn {index} must be a PiiTurn or a mapping")
        turns.append(candidate)
    return turns


def apply_pii_thresholds(probabilities: dict[str, float]) -> list[str]:
    """Labels at or above their own published threshold, in fixed index order."""
    return [
        label
        for label in PII_LABELS
        if probabilities.get(label, 0.0) >= PII_THRESHOLDS[label]
    ]


def decision_score(label: str, probability: float) -> float:
    """Rescale one label's probability around its own threshold.

    Guardian's fusion layer needs one comparable number per message, and the
    three labels do not share a scale: 0.12 is a firing decision for
    directing_users_off_platform and nothing at all for privacy_asking_for_pii.
    Handing the raw maximum downstream would drop every off-platform hit below
    every fusion threshold, which is the same class of silent loss as encoding
    the input wrong.

    So each probability is mapped monotonically onto a shared scale where 0.5 is
    exactly that label's published threshold. This is Guardian's mapping, not
    the model card's. The card's decision is preserved exactly: a label fires if
    and only if its decision score is at or above 0.5.
    """
    threshold = PII_THRESHOLDS[label]
    if probability >= threshold:
        headroom = 1.0 - threshold
        return 0.5 + 0.5 * ((probability - threshold) / headroom if headroom else 1.0)
    return 0.5 * (probability / threshold) if threshold else 0.0


def _sigmoid(value: float) -> float:
    if value >= 0:
        return 1.0 / (1.0 + math.exp(-value))
    exponent = math.exp(value)
    return exponent / (1.0 + exponent)


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
    """One scored message or conversation window.

    `score` is the fused 0 to 1 number the pair scorer consumes. `labels` and
    `fired` are the model's own output: raw sigmoid probabilities per label, and
    which of them crossed the card's threshold. On the rule fallback `labels` is
    empty and `fired` names no model label, because a rule did not produce one.
    """

    score: float
    matched: list[str] = field(default_factory=list)
    model_version: str = RULES_VERSION
    labels: dict[str, float] = field(default_factory=dict)
    fired: list[str] = field(default_factory=list)
    source: str = "rule"


class PiiMigrationClassifier:
    """Roblox PII classifier v2 with a rule fallback.

    Set GUARDIAN_PII_MODEL to a local path or a Hub id to load real weights.
    With no model present the fallback runs, `version.loaded` stays False and
    `source` is "rule", so every score row records that a rule produced it
    rather than a model.

    Weights are never fetched over the network unless GUARDIAN_PII_ALLOW_DOWNLOAD
    is set as well. Two opt-ins, so no test run and no cold start can pull half a
    gigabyte by surprise.
    """

    def __init__(
        self,
        model_id: str | None = None,
        logits_fn: Callable[[str], Sequence[float]] | None = None,
    ) -> None:
        self.model_id = model_id or os.environ.get("GUARDIAN_PII_MODEL") or PII_MODEL_ID
        self._model = None
        self._tokenizer = None
        # Injected in tests so the contract and the threshold arithmetic can be
        # exercised without weights on disk.
        self._logits_fn = logits_fn
        self.version = ModelVersion(name=RULES_VERSION, loaded=False)
        self._tried = False
        if logits_fn is not None:
            self._tried = True
            self.version = ModelVersion(name=self.model_id, revision="injected", loaded=True)

    def _load(self) -> None:
        if self._tried:
            return
        self._tried = True
        if os.environ.get("GUARDIAN_PII_MODEL") is None:
            # No explicit opt-in means no network call and no surprise download.
            return
        allow_download = os.environ.get("GUARDIAN_PII_ALLOW_DOWNLOAD") == "1"
        try:
            from transformers import (  # type: ignore[import-not-found]
                AutoModelForSequenceClassification,
                AutoTokenizer,
            )

            tokenizer = AutoTokenizer.from_pretrained(
                self.model_id, local_files_only=not allow_download
            )
            # Set on the instance, not passed per call. The card is explicit
            # that overflow drops the oldest turns, never the newest.
            tokenizer.truncation_side = PII_TRUNCATION_SIDE
            model = AutoModelForSequenceClassification.from_pretrained(
                self.model_id, local_files_only=not allow_download
            )
            model.eval()
            self._tokenizer = tokenizer
            self._model = model
            self.version = ModelVersion(
                name=self.model_id,
                revision=getattr(model.config, "_commit_hash", None) or "local",
                loaded=True,
            )
        except Exception:  # pragma: no cover - depends on the host's model cache
            self._tokenizer = None
            self._model = None

    def loaded(self) -> bool:
        self._load()
        return self._logits_fn is not None or self._model is not None

    def score(
        self,
        text: str,
        history: Sequence[PiiTurn] | Sequence[dict[str, str]] | None = None,
    ) -> PiiResult:
        """Score one message, optionally in its conversational context.

        `history` is the preceding turns including the target speaker's own, in
        order. `text` is the target speaker's latest turn and is appended as a
        "t" turn. v2 is context aware and the card reports its best numbers with
        context, so pass history whenever the surface has it.
        """
        turns: list[PiiTurn] = list(_coerce_turns(history)) if history else []
        turns.append(PiiTurn(speaker=PII_TARGET_SPEAKER, text=text))
        return self.score_conversation(turns)

    def score_conversation(
        self, turns: Sequence[PiiTurn] | Sequence[dict[str, str]]
    ) -> PiiResult:
        self._load()
        formatted = format_pii_input(turns)

        probabilities = self._probabilities(formatted)
        if probabilities is None:
            target_text = " ".join(
                turn.text for turn in _coerce_turns(turns) if turn.speaker == PII_TARGET_SPEAKER
            )
            return self._fallback(target_text)

        fired = apply_pii_thresholds(probabilities)
        score = max(
            (decision_score(label, probabilities[label]) for label in PII_LABELS),
            default=0.0,
        )
        return PiiResult(
            score=round(score, 6),
            matched=fired,
            model_version=str(self.version),
            labels={label: round(probabilities[label], 6) for label in PII_LABELS},
            fired=fired,
            source="model",
        )

    def _probabilities(self, formatted: str) -> dict[str, float] | None:
        """Raw sigmoid probabilities in fixed label order, or None if unloaded."""
        if self._logits_fn is not None:
            logits = list(self._logits_fn(formatted))
        elif self._model is not None and self._tokenizer is not None:  # pragma: no cover
            import torch  # type: ignore[import-not-found]

            encoded = self._tokenizer(
                formatted,
                padding=PII_PADDING,
                max_length=PII_MAX_LENGTH,
                truncation=True,
                return_tensors="pt",
            )
            with torch.inference_mode():
                raw = self._model(**encoded).logits
            logits = [float(v) for v in raw[0].float().cpu().tolist()]
        else:
            return None

        if len(logits) != len(PII_LABELS):
            raise ValueError(
                f"expected {len(PII_LABELS)} logits in the fixed label order, got {len(logits)}"
            )
        return {label: _sigmoid(logits[i]) for i, label in enumerate(PII_LABELS)}

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

        return PiiResult(
            score=score,
            matched=matched,
            model_version=RULES_VERSION,
            labels={},
            fired=[],
            source="rule",
        )


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
