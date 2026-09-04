"""The Roblox PII v2 input contract, pinned.

R1 exists because encoding this model's input as JSON, or as the bare message,
silently throws away the measured F1. Nothing crashes and no test goes red; the
model just reads something it was never trained on. So the encoding is asserted
byte for byte against a fixture that was hand-written from the model card rather
than generated from the formatter. A refactor that changes the string has to
change the fixture too, which makes it a decision instead of an accident.

No weights are loaded here and nothing is downloaded. The threshold arithmetic
is exercised through an injected logits function.

Source: https://huggingface.co/Roblox/roblox-pii-classifier-v2 (read 2026-09-04).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.classifiers import (
    PII_INSTRUCTION_PREFIX,
    PII_INSTRUCTION_SEPARATOR,
    PII_LABELS,
    PII_MAX_LENGTH,
    PII_THRESHOLDS,
    PII_TRUNCATION_SIDE,
    PII_TURN_SEPARATOR,
    PiiMigrationClassifier,
    PiiTurn,
    apply_pii_thresholds,
    decision_score,
    format_pii_input,
)

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "pii_input_contract.json").read_text("utf-8")
)


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: c["name"])
def test_formatted_input_matches_the_fixture_byte_for_byte(case):
    built = format_pii_input(case["input"])
    assert built == case["expected"]
    assert built.encode("utf-8") == case["expected"].encode("utf-8")


def test_the_separator_is_the_literal_five_characters_with_spaces():
    # " </s> ", not "</s>" and not "\n". The spaces are part of the training
    # formatter and a strip() here would change every input the model sees.
    assert PII_TURN_SEPARATOR == " </s> "
    assert PII_INSTRUCTION_SEPARATOR == "\n\n"
    assert PII_INSTRUCTION_PREFIX.endswith("\nQuery:")


def test_tokenizer_parameters_match_the_card():
    tokenizer = FIXTURE["tokenizer"]
    assert PII_MAX_LENGTH == tokenizer["max_length"]
    # Left truncation is the one that matters. Right truncation would drop the
    # message being scored and keep the small talk.
    assert PII_TRUNCATION_SIDE == tokenizer["truncation_side"] == "left"


def test_labels_and_thresholds_match_the_card_in_index_order():
    assert list(PII_LABELS) == FIXTURE["labels"]
    assert PII_THRESHOLDS == FIXTURE["thresholds"]


def test_empty_conversation_is_refused():
    with pytest.raises(ValueError):
        format_pii_input([])


def test_a_turn_without_a_speaker_is_refused():
    with pytest.raises(ValueError):
        format_pii_input([{"text": "no speaker here"}])


# --- thresholds ------------------------------------------------------------


def _fixed(probabilities: dict[str, float]):
    """A logits function that reproduces the requested sigmoid probabilities."""
    import math

    def logits(_formatted: str) -> list[float]:
        out = []
        for label in PII_LABELS:
            p = min(max(probabilities.get(label, 0.0), 1e-9), 1 - 1e-9)
            out.append(math.log(p / (1 - p)))
        return out

    return logits


def test_each_label_is_thresholded_independently():
    # Off-platform fires at 0.10 while the other two sit well under theirs.
    fired = apply_pii_thresholds(
        {
            "privacy_asking_for_pii": 0.4,
            "privacy_giving_pii": 0.5,
            "directing_users_off_platform": 0.12,
        }
    )
    assert fired == ["directing_users_off_platform"]


def test_a_probability_exactly_on_the_threshold_fires():
    assert apply_pii_thresholds({"privacy_giving_pii": 0.55}) == ["privacy_giving_pii"]


def test_decision_score_puts_every_threshold_at_one_half():
    for label, threshold in PII_THRESHOLDS.items():
        assert decision_score(label, threshold) == pytest.approx(0.5)
        assert decision_score(label, 0.0) == pytest.approx(0.0)
        assert decision_score(label, 1.0) == pytest.approx(1.0)


def test_a_firing_off_platform_label_is_not_buried_by_its_low_threshold():
    # The regression this guards: 0.12 raw is a fire, and handing 0.12 to the
    # fusion layer would read as noise.
    classifier = PiiMigrationClassifier(
        logits_fn=_fixed(
            {
                "privacy_asking_for_pii": 0.05,
                "privacy_giving_pii": 0.05,
                "directing_users_off_platform": 0.12,
            }
        )
    )
    result = classifier.score("lets keep talking somewhere else")
    assert result.fired == ["directing_users_off_platform"]
    assert result.score >= 0.5
    assert result.source == "model"


def test_a_quiet_message_scores_below_every_threshold():
    classifier = PiiMigrationClassifier(
        logits_fn=_fixed(
            {
                "privacy_asking_for_pii": 0.02,
                "privacy_giving_pii": 0.02,
                "directing_users_off_platform": 0.03,
            }
        )
    )
    result = classifier.score("gg that was a close game")
    assert result.fired == []
    assert result.score < 0.5


def test_the_model_sees_the_history_it_was_given():
    seen: list[str] = []

    def capture(formatted: str) -> list[float]:
        seen.append(formatted)
        return [-9.0, -9.0, -9.0]

    classifier = PiiMigrationClassifier(logits_fn=capture)
    classifier.score(
        "add me on snap",
        history=[
            PiiTurn(speaker="kai", text="how do i reach you"),
            PiiTurn(speaker="t", text="not on here"),
        ],
    )

    assert seen == [
        PII_INSTRUCTION_PREFIX
        + PII_INSTRUCTION_SEPARATOR
        + "s1: how do i reach you </s> t: not on here </s> t: add me on snap"
    ]


def test_a_wrong_number_of_logits_is_an_error_not_a_silent_reorder():
    classifier = PiiMigrationClassifier(logits_fn=lambda _formatted: [0.1, 0.2])
    with pytest.raises(ValueError):
        classifier.score("add me on snap")


def test_no_weights_means_the_rule_fallback_and_it_says_so():
    classifier = PiiMigrationClassifier()
    result = classifier.score("add me on snapchat, my user is ryan_xx99")
    assert result.source == "rule"
    assert result.model_version == "rules-v1"
    assert result.labels == {}
    assert result.fired == []
    assert classifier.loaded() is False


def test_the_fallback_scores_the_target_speaker_not_the_context():
    # Another speaker naming a platform must not score the target speaker.
    classifier = PiiMigrationClassifier()
    result = classifier.score_conversation(
        [
            PiiTurn(speaker="ash", text="add me on discord, my user is ash_2011"),
            PiiTurn(speaker="t", text="ok cool"),
        ]
    )
    assert result.score < 0.1
