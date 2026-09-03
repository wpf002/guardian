"""Model versioning.

Every score row records model_version, lexicon_version and fusion_version
(CLAUDE.md conventions). The ML service owns the first of those and must report
it on every response, including when it is running the rule fallback rather
than a loaded model.
"""

from dataclasses import dataclass

SERVICE_VERSION = "0.1.0"

# Phase 1 runs rules while the Roblox PII classifier v2 weights are wired in.
# When a model loads, the version becomes the model id and revision, so a score
# taken today can be reproduced against the exact weights that produced it.
RULES_VERSION = "rules-v1"

PII_MODEL_ID = "Roblox/roblox-pii-classifier-v2"
STAGE_MODEL_ID = "guardian/stage-classifier"  # phase 2


@dataclass(frozen=True)
class ModelVersion:
    name: str
    revision: str | None = None
    loaded: bool = False

    def __str__(self) -> str:
        if not self.loaded:
            return f"{self.name}:unloaded"
        return f"{self.name}@{self.revision}" if self.revision else self.name
