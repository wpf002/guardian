from app.classifiers import PiiMigrationClassifier, StageClassifier


def test_concrete_handoff_scores_high():
    result = PiiMigrationClassifier().score("add me on snapchat, my user is ryan_xx99")
    assert result.score >= 0.8
    assert "snapchat" in result.matched


def test_talking_about_an_app_scores_low():
    result = PiiMigrationClassifier().score("discord was down for everyone last night")
    assert result.score < 0.5


def test_ordinary_chat_scores_near_zero():
    result = PiiMigrationClassifier().score("gg that was a close game")
    assert result.score < 0.1


def test_spaced_out_platform_is_still_seen():
    result = PiiMigrationClassifier().score("dm me on t e l e g r a m")
    assert result.score >= 0.6


def test_rule_fallback_is_named_as_a_rule():
    result = PiiMigrationClassifier().score("add me on snap")
    assert result.model_version == "rules-v1"


def test_stage_classifier_reports_that_it_is_not_loaded():
    result = StageClassifier().score("are your parents home")
    assert result.loaded is False
    assert result.probs["none"] == 1.0
    assert "unloaded" in result.model_version
