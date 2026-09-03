import { MODEL_MAX_TIER, type ActorScore, type SignalKind, type Tier } from "@guardian/schema";
import type { PairScoreResult } from "./pair.js";

/**
 * Fusion and tier assignment (DESIGN.md 6.4).
 *
 * Phase 1 fusion is hand-tuned rules. The learned gradient-boosted version
 * arrives once reviewer decisions exist to train on, and it plugs in behind the
 * same `Fusion` interface so nothing downstream changes.
 *
 * Two structural rules, not thresholds:
 *
 *   1. T2 requires either an ordered progression pattern or a critical signal.
 *      Real platform base rates are near 0.01%. A classifier at 99% specificity
 *      produces roughly 100 false alarms per true hit, so a score threshold on
 *      its own cannot carry T2.
 *   2. The model never emits T3. Only a human reviewer produces T3
 *      (CLAUDE.md rule 6).
 */

export const FUSION_VERSION = "rules-v1";

export interface FusionThresholds {
  /** Fused score at which a pair becomes worth retaining and watching. */
  t1: number;
  /** Fused score at which a pair enters the review queue, if the T2 gate is also met. */
  t2: number;
  /** Weight on the actor score relative to the pair score. */
  actorWeight: number;
}

export const DEFAULT_THRESHOLDS: FusionThresholds = {
  t1: 1.2,
  t2: 3.0,
  actorWeight: 0.5,
};

export interface FusionInput {
  pair: PairScoreResult;
  actor: ActorScore & { rationale: string[] };
  thresholds?: Partial<FusionThresholds>;
}

export interface FusionOutput {
  tier: Tier;
  fusedScore: number;
  rationale: string[];
  criticalSignals: SignalKind[];
  /** Why this tier and not the next one up. Shown to the reviewer. */
  gate: string;
}

export function fuse(input: FusionInput): FusionOutput {
  const t = { ...DEFAULT_THRESHOLDS, ...(input.thresholds ?? {}) };
  const { pair, actor } = input;

  const fusedScore = Number((pair.score + t.actorWeight * actor.score).toFixed(4));
  const critical = pair.criticalSignals;
  const rationale = [...pair.rationale, ...actor.rationale];

  // Any critical signal forces tier >= T2 regardless of the fused score
  // (CLAUDE.md "Tiers", DESIGN.md 6.2 crit_override).
  if (critical.length > 0) {
    return {
      tier: capAtModelMax("T2"),
      fusedScore,
      rationale: [criticalSentence(critical), ...rationale],
      criticalSignals: critical,
      gate: "critical signal present",
    };
  }

  if (fusedScore >= t.t2 && pair.hasProgressionPattern) {
    return {
      tier: capAtModelMax("T2"),
      fusedScore,
      rationale,
      criticalSignals: critical,
      gate: "progression pattern and score above T2 threshold",
    };
  }

  if (fusedScore >= t.t1) {
    return {
      tier: "T1",
      fusedScore,
      rationale,
      criticalSignals: critical,
      gate:
        fusedScore >= t.t2
          ? "score above T2 threshold but no ordered progression pattern, held at watch"
          : "score above T1 threshold",
    };
  }

  return {
    tier: "T0",
    fusedScore,
    rationale,
    criticalSignals: critical,
    gate: "below T1 threshold",
  };
}

/**
 * Structural guarantee that the model cannot emit T3, wherever it is called
 * from. The reviewer path in apps/review is the only producer of T3.
 */
export function capAtModelMax(tier: Tier): Tier {
  return tier === "T3" ? MODEL_MAX_TIER : tier;
}

const CRITICAL_TEXT: Record<SignalKind, string> = {
  threat_template: "Message matches a known extortion script.",
  payment_after_media: "A payment demand followed an inbound media event within the hour.",
  meetup_logistics: "In-person meeting logistics discussed across an age gap.",
  known_csam_hash: "The operator's hash check returned a known-CSAM match.",
  supervision_probe: "",
  off_platform_migration: "",
  secrecy_instruction: "",
  economic_bait: "",
  age_relationship_framing: "",
  image_solicitation: "",
  actor_fanout: "",
  new_account_burst: "",
  alt_cluster: "",
  skew_drift: "",
};

function criticalSentence(signals: SignalKind[]): string {
  return signals
    .map((s) => CRITICAL_TEXT[s])
    .filter(Boolean)
    .join(" ");
}
