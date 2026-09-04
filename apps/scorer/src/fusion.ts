import {
  isMinorBand,
  MODEL_MAX_TIER,
  type ActorScore,
  type SignalKind,
  type Tier,
} from "@guardian/schema";
import { NO_FANIN, type FanInSignal } from "./actor.js";
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
 *   3. Fan-IN multiplies the pair score, it never creates one. A pair with
 *      no behavioural signal multiplies to nothing, which is what keeps a
 *      popular account from being tiered for being popular.
 */

/** Bumped for the two velocity windows, fan-IN and the posture branch. */
export const FUSION_VERSION = "rules-v2";

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
  /**
   * Target-side convergence, from `scoreFanIn` on the receiving account's
   * actor state (ROADMAP S1). Absent means the caller has not wired it and
   * the term is neutral.
   */
  targetFanIn?: FanInSignal;
}

/**
 * What the operator should do with this, before anyone reads the tier as an
 * instruction to enforce (ROADMAP S4). Patchin and Hinduja (n=5,568) found
 * perpetrators are disproportionately former victims, and Thorn 2025 found
 * 54% of known-contact sextortion perpetrators are themselves minors. Guardian's
 * fan-out and threat-template detectors will therefore tier minors, and timing
 * out a child is the wrong action.
 */
export type SuggestedPosture = "enforcement" | "support";

/**
 * Shown with the support posture. Names no person, describes no person, and
 * points at the two services that remove the images rather than at an action
 * against an account.
 */
export const SUPPORT_REFERRAL = [
  "The account this tier describes is itself in a minor age band. A removal and welfare route fits this better than an enforcement action.",
  "Image removal: NCMEC Take It Down (takeitdown.ncmec.org) for anyone under 18, StopNCII.org for 18 and over. Both work from a hash generated on the device, so no image is uploaded.",
].join(" ");

export interface FusionOutput {
  tier: Tier;
  fusedScore: number;
  rationale: string[];
  criticalSignals: SignalKind[];
  /** Why this tier and not the next one up. Shown to the reviewer. */
  gate: string;
  /** Target-side convergence as it was applied (ROADMAP S1). */
  fanIn: FanInSignal;
  /** Which velocity window carried the term, so a reviewer sees sprint or campaign. */
  velocityWindow: PairScoreResult["velocityDetail"]["window"];
  /** Enforcement or support (ROADMAP S4). Read by the bot and the reviewer UI. */
  suggestedPosture: SuggestedPosture;
  /** Referral text, present only under the support posture. */
  supportReferral: string | null;
}

export function fuse(input: FusionInput): FusionOutput {
  const t = { ...DEFAULT_THRESHOLDS, ...(input.thresholds ?? {}) };
  const { pair, actor } = input;
  const fanIn = input.targetFanIn ?? NO_FANIN;

  // Fan-IN scales the pair term only. Multiplying the fused score would let a
  // busy account inflate on the actor term alone, which is the popular-streamer
  // false positive the guards exist to avoid.
  const fusedScore = Number((pair.score * fanIn.multiplier + t.actorWeight * actor.score).toFixed(4));
  const critical = pair.criticalSignals;
  const rationale = [...pair.rationale, ...fanIn.rationale, ...actor.rationale];

  const posture = suggestedPosture(pair);
  const common = {
    fusedScore,
    criticalSignals: critical,
    fanIn,
    velocityWindow: pair.velocityDetail.window,
    suggestedPosture: posture,
    supportReferral: posture === "support" ? SUPPORT_REFERRAL : null,
  };

  // Any critical signal forces tier >= T2 regardless of the fused score
  // (CLAUDE.md "Tiers", DESIGN.md 6.2 crit_override).
  if (critical.length > 0) {
    return {
      ...common,
      tier: capAtModelMax("T2"),
      rationale: [criticalSentence(critical), ...rationale],
      gate: "critical signal present",
    };
  }

  if (fusedScore >= t.t2 && pair.hasProgressionPattern) {
    return {
      ...common,
      tier: capAtModelMax("T2"),
      rationale,
      gate: "progression pattern and score above T2 threshold",
    };
  }

  if (fusedScore >= t.t1) {
    return {
      ...common,
      tier: "T1",
      rationale,
      gate:
        fusedScore >= t.t2
          ? "score above T2 threshold but no ordered progression pattern, held at watch"
          : "score above T1 threshold",
    };
  }

  return {
    ...common,
    tier: "T0",
    rationale,
    gate: "below T1 threshold",
  };
}

/**
 * Enforcement or support (ROADMAP S4). The account a tier is about is the pair's
 * actor. When that account is itself in a minor band, the right response is a
 * welfare and removal route, not a timeout. Bands are not always known, and an
 * unknown band is not evidence of a minor, so the default is enforcement.
 */
export function suggestedPosture(pair: PairScoreResult): SuggestedPosture {
  return isMinorBand(pair.actorBand) ? "support" : "enforcement";
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
  coercion_nonfinancial:
    "An instruction to self-harm or to produce a mark was recorded on this pair. The demand is compliance rather than money, so the payment join does not see it.",
  meetup_logistics: "In-person meeting logistics discussed across an age gap.",
  known_csam_hash: "The operator's hash check returned a known-CSAM match.",
  supervision_probe: "",
  off_platform_migration: "",
  secrecy_instruction: "",
  economic_bait: "",
  age_relationship_framing: "",
  image_solicitation: "",
  actor_fanout: "",
  target_fanin: "",
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
