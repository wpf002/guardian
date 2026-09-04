from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_health_reports_what_is_loaded():
    body = client.get("/health").json()
    assert body["ok"] is True
    assert body["scripts_indexed"] >= 10
    assert body["stage_model_loaded"] is False


def test_score_returns_a_version_on_every_response():
    body = client.post("/score", json={"text": "add me on snapchat"}).json()
    assert body["model_version"]
    assert body["pii_migration"] > 0


def test_score_flags_a_known_script():
    body = client.post(
        "/score",
        json={
            "text": "i have all your friends and family list. if you dont send me the "
            "money i will send your pictures to everyone you know. you have 1 hour"
        },
    ).json()
    assert body["script"]["id"] == "sx-001"
    assert body["script_match"] > 0.35


def test_there_is_no_endpoint_that_accepts_bytes():
    paths = app.openapi()["paths"]
    assert set(paths) == {"/health", "/score"}
    schema = app.openapi()["components"]["schemas"]["ScoreIn"]["properties"]
    for field in schema:
        assert field not in {"image", "bytes", "media", "attachment", "url"}


def test_score_accepts_conversational_history_for_the_pii_contract():
    body = client.post(
        "/score",
        json={
            "text": "add me on snapchat",
            "history": [
                {"speaker": "kai", "text": "how do i reach you outside here"},
                {"speaker": "t", "text": "not on this app"},
            ],
        },
    ).json()
    assert body["pii_migration"] > 0
    # No weights in CI, so the rule fallback answers and names itself.
    assert body["pii_source"] == "rule"
    assert body["pii_labels"] == {}


def test_history_turns_carry_no_media_fields():
    schema = app.openapi()["components"]["schemas"]["TurnIn"]["properties"]
    assert set(schema) == {"speaker", "text"}
