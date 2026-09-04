"""Guardian ML service.

The only Python in the stack (CLAUDE.md). It holds the stage classifier, the
embeddings, the Roblox PII classifier and the MinHash script index, and it
returns a version string on every response so the scorer can record which
weights produced a score.

Two rules apply here as much as anywhere else:

  * There is no endpoint that accepts image or video bytes, and no code path
    that fetches a URL. Media reaches Guardian as a sha256 and the operator's
    own scanner verdict (CLAUDE.md rule 1).
  * Nothing here labels a person. It returns probabilities and match ids
    (CLAUDE.md rule 5).
"""

from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel, Field

from app.classifiers import PiiMigrationClassifier, PiiTurn, StageClassifier
from app.scripts import load_index
from app.versions import SERVICE_VERSION

app = FastAPI(title="guardian-ml", version=SERVICE_VERSION)

pii = PiiMigrationClassifier()
stage = StageClassifier()
scripts = load_index()


class TurnIn(BaseModel):
    """One preceding turn, for the PII classifier's conversational context.

    Speaker names are the caller's own. The formatter anonymizes them to t, s1
    and s2 before the model sees anything, so no platform identifier reaches the
    weights. Use the literal "t" for the speaker being scored.
    """

    speaker: str = Field(min_length=1, max_length=64)
    text: str = Field(max_length=2000)


class ScoreIn(BaseModel):
    text: str = Field(max_length=8000)
    # Preceding turns, oldest first. Roblox PII v2 is context aware and reports
    # its best numbers with context, so pass history when the surface has it.
    # The model window is 512 tokens with the oldest turns dropped on overflow.
    history: list[TurnIn] = Field(default_factory=list, max_length=64)
    actor_band: str = "UNKNOWN"
    target_band: str = "UNKNOWN"
    script_threshold: float = 0.35


class ScriptMatchOut(BaseModel):
    id: str
    label: str
    similarity: float


class ScoreOut(BaseModel):
    stage_probs: dict[str, float]
    stage_model_loaded: bool
    pii_migration: float
    pii_matched: list[str]
    # The model's own output when weights are loaded: raw sigmoid probabilities
    # per label, and which crossed the card's published threshold. Empty on the
    # rule fallback, where `pii_source` reads "rule".
    pii_labels: dict[str, float]
    pii_fired: list[str]
    pii_source: str
    script_match: float
    script: ScriptMatchOut | None
    model_version: str


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "ok": True,
        "service_version": SERVICE_VERSION,
        "scripts_indexed": len(scripts),
        "pii_model_loaded": pii.loaded(),
        "pii_model_id": pii.model_id,
        "stage_model_loaded": stage.version.loaded,
    }


@app.post("/score", response_model=ScoreOut)
def score(inp: ScoreIn) -> ScoreOut:
    pii_result = pii.score(
        inp.text,
        history=[PiiTurn(speaker=t.speaker, text=t.text) for t in inp.history],
    )
    stage_result = stage.score(inp.text)
    match = scripts.query(inp.text.lower(), inp.script_threshold)

    return ScoreOut(
        stage_probs=stage_result.probs,
        stage_model_loaded=stage_result.loaded,
        pii_migration=pii_result.score,
        pii_matched=pii_result.matched,
        pii_labels=pii_result.labels,
        pii_fired=pii_result.fired,
        pii_source=pii_result.source,
        script_match=match.similarity if match else 0.0,
        script=ScriptMatchOut(id=match.id, label=match.label, similarity=match.similarity)
        if match
        else None,
        # The triple the scorer records. Rules are named as rules so a score is
        # never mistaken for a model's output.
        model_version=f"pii={pii_result.model_version};stage={stage_result.model_version}",
    )
