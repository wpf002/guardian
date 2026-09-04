import {
  ageGapMultiplier,
  bandGap,
  isAdultBand,
  isMinorBand,
  sameBand,
  STAGE_INDEX,
  type AgeBand,
  type SignalHit,
  type SignalKind,
  type Stage,
} from "@guardian/schema";
import type { Detection } from "./detectors/index.js";

/**
 * Per-pair trajectory score (DESIGN.md 6.2).
 *
 * The mistake in the academic work is scoring a conversation as a whole and
 * averaging, which buries a 30 second escalation inside a week of "what's your
 * favourite game". This scores the ordered progression, the speed, who is
 * driving, and the age gap, and never the mean.
 */

export interface PairWeights {
  progression: number;
  velocity: number;
  asymmetry: number;
  ageGap: number;
  economic: number;
}

/** Hand-tuned starting points. Changing these requires the DESIGN.md 10 suite. */
export const DEFAULT_PAIR_WEIGHTS: PairWeights = {
  progression: 1.0,
  velocity: 0.7,
  asymmetry: 0.5,
  ageGap: 0.6,
  economic: 0.4,
};

export interface PairConfig {
  weights?: Partial<PairWeights>;
  /**
   * "dual" computes the fast and the slow window and takes the stronger.
   * "single" keeps the original DESIGN.md 6.2 behaviour on `velocityWindowMs`.
   */
  velocityMode?: "dual" | "single";
  /** Trailing window for the single-window velocity term (DESIGN.md 6.2). */
  velocityWindowMs?: number;
  /** Sprint window. The hyper-sexualised population escalates inside it. */
  fastWindowMs?: number;
  /** Campaign window. The intimacy-seeking population takes weeks. */
  slowWindowMs?: number;
  /** How long after a media event a payment demand still counts as the join. */
  paymentJoinMs?: number;
}

/**
 * Two velocity windows (ROADMAP S2). DESIGN.md 6.2 uses one 24h window, which
 * misses one of the two populations by construction. The European Online
 * Grooming Project (Webster et al. 2012, n=33) splits hyper-sexualised
 * offenders who escalate in under 4h from intimacy-seeking offenders who take
 * weeks, and Thorn 2025 found 30% of sextortion demands land within 24h of
 * contact, which means 70% do not. The 24h window is kept and configurable so
 * the old behaviour is still reproducible for a score row that recorded it.
 */
export const DEFAULT_PAIR_CONFIG = {
  velocityWindowMs: 24 * 60 * 60 * 1000,
  fastWindowMs: 4 * 60 * 60 * 1000,
  slowWindowMs: 14 * 24 * 60 * 60 * 1000,
  paymentJoinMs: 60 * 60 * 1000,
} as const;

export interface PairMessage {
  externalId: string;
  ts: Date;
  direction: "actor_to_target" | "target_to_actor";
  /** Present only when the message carried a media hash. */
  media?: { sha256: string; knownCsamVerdict: "match" | "no_match" | "not_run" } | null;
  detections: Detection[];
  isQuestion: boolean;
  channel: string;
}

/**
 * Rolling state for one (actor, target) pair. Held in Postgres between runs;
 * the workers themselves are stateless (CLAUDE.md conventions).
 */
export interface PairState {
  actorBand: AgeBand;
  targetBand: AgeBand;
  actorMessages: number;
  targetMessages: number;
  actorQuestions: number;
  /** First time each stage was reached, in event time. */
  firstStageAt: Partial<Record<Stage, string>>;
  /** Every gated hit that mattered, capped so state cannot grow without bound. */
  signals: SignalHit[];
  /** Media sent by the target to the actor. The reciprocal image in the sextortion pattern. */
  lastInboundMediaAt: string | null;
  knownCsamMatch: boolean;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  /**
   * External ids of the most recent messages folded in, newest last. A
   * message whose id is here is a replay (a customer retry, a redelivered
   * stream entry) and leaves the state alone, so counts, signals and stage
   * times are never doubled.
   */
  recentExternalIds: string[];
}

export function emptyPairState(actorBand: AgeBand, targetBand: AgeBand): PairState {
  return {
    actorBand,
    targetBand,
    actorMessages: 0,
    targetMessages: 0,
    actorQuestions: 0,
    firstStageAt: {},
    signals: [],
    lastInboundMediaAt: null,
    knownCsamMatch: false,
    firstSeenAt: null,
    lastSeenAt: null,
    recentExternalIds: [],
  };
}

const HOUR_MS = 60 * 60 * 1000;
/** Span floor for the 14 day window, in the shared stages-per-hour unit. */
const SLOW_SPAN_FLOOR_HOURS = 24;

const MAX_STORED_SIGNALS = 200;
/** Replay window in messages. A retry arrives within seconds, not hundreds of messages later. */
export const MAX_RECENT_EXTERNAL_IDS = 200;

/** True when this message was already folded into the state. */
export function hasSeenMessage(state: PairState, externalId: string): boolean {
  return state.recentExternalIds.includes(externalId);
}

export interface PairScoreComponents {
  progression: number;
  velocity: number;
  asymmetry: number;
  ageGap: number;
  economic: number;
}

/**
 * Which of the two windows carried the velocity term, so a reviewer can see
 * whether this was a sprint or a campaign rather than a bare number.
 */
export interface VelocityDetail {
  fast: number;
  slow: number;
  /** The original single 24h window, always computed for comparability. */
  standard: number;
  /** The window the score used, or null when neither window scored. */
  window: "fast" | "slow" | "standard" | null;
  fastWindowMs: number;
  slowWindowMs: number;
  standardWindowMs: number;
}

export interface PairScoreResult {
  score: number;
  components: PairScoreComponents;
  stagesHit: Stage[];
  criticalSignals: SignalKind[];
  signals: SignalHit[];
  /** True when the ladder was walked in order, which is the T2 gate. */
  hasProgressionPattern: boolean;
  velocityDetail: VelocityDetail;
  /**
   * Carried through so fusion can pick a posture without the kernel having to
   * thread bands separately (ROADMAP S4).
   */
  actorBand: AgeBand;
  targetBand: AgeBand;
  rationale: string[];
}

/**
 * Fold one message into pair state. Returns the updated state; the caller
 * persists it. Gating happens here, once, so the stored signal weight is the
 * one the score used.
 */
export function applyMessage(state: PairState, msg: PairMessage): PairState {
  if (hasSeenMessage(state, msg.externalId)) return state;

  const next: PairState = {
    ...state,
    firstStageAt: { ...state.firstStageAt },
    signals: [...state.signals],
    recentExternalIds: [...state.recentExternalIds, msg.externalId].slice(-MAX_RECENT_EXTERNAL_IDS),
  };

  const ts = msg.ts.toISOString();
  next.firstSeenAt ??= ts;
  next.lastSeenAt = ts;

  if (msg.direction === "actor_to_target") {
    next.actorMessages += 1;
    if (msg.isQuestion) next.actorQuestions += 1;
  } else {
    next.targetMessages += 1;
  }

  if (msg.media) {
    if (msg.media.knownCsamVerdict === "match") {
      next.knownCsamMatch = true;
      next.signals.push({
        kind: "known_csam_hash",
        stage: "sexualize",
        weight: 3.0,
        matched: `operator verdict on ${msg.media.sha256.slice(0, 12)}`,
        eventExternalId: msg.externalId,
        // The kernel never reads material. Only a reviewer action sets this.
        viewedByHuman: false,
        ts: msg.ts,
      });
    }
    if (msg.direction === "target_to_actor") {
      next.lastInboundMediaAt = ts;
    }
  }

  // Only the actor's own messages move the actor's trajectory. A child saying
  // "my parents are divorced" is not a supervision probe.
  if (msg.direction !== "actor_to_target") return trim(next);

  for (const detection of msg.detections) {
    const gated = gate(detection, next);
    if (gated.weight <= 0) continue;

    next.signals.push({
      kind: gated.kind,
      stage: detection.stage,
      weight: Number(gated.weight.toFixed(3)),
      excerpt: detection.excerpt.slice(0, 280),
      matched: detection.matched.slice(0, 280),
      eventExternalId: msg.externalId,
      viewedByHuman: false,
      ts: msg.ts,
    });

    if (detection.stage !== "none" && next.firstStageAt[detection.stage] === undefined) {
      next.firstStageAt[detection.stage] = ts;
    }
  }

  // Temporal join: a payment entity from the actor shortly after the target
  // sent media. DESIGN.md 5 lists this with no false positives in practice.
  const paymentHit = msg.detections.find(
    (d) => d.kind === "economic_bait" && d.meta?.payment_entity === true,
  );
  if (paymentHit && next.lastInboundMediaAt) {
    const gapMs = msg.ts.getTime() - new Date(next.lastInboundMediaAt).getTime();
    if (gapMs >= 0 && gapMs <= DEFAULT_PAIR_CONFIG.paymentJoinMs) {
      next.signals.push({
        kind: "payment_after_media",
        stage: "coerce",
        weight: 3.0,
        excerpt: paymentHit.excerpt.slice(0, 280),
        matched: `payment entity ${Math.round(gapMs / 60000)} min after inbound media`,
        eventExternalId: msg.externalId,
        viewedByHuman: false,
        ts: msg.ts,
      });
      next.firstStageAt.coerce ??= ts;
    }
  }

  return trim(next);
}

function trim(state: PairState): PairState {
  if (state.signals.length > MAX_STORED_SIGNALS) {
    state.signals = state.signals.slice(-MAX_STORED_SIGNALS);
  }
  return state;
}

/**
 * The false-positive traps from DESIGN.md 5, applied as multipliers. Each one
 * has a case-file reason, and each one is the difference between a usable
 * queue and a reviewer drowning in teenagers swapping usernames.
 */
function gate(d: Detection, state: PairState): { kind: SignalKind; weight: number } {
  const gap = bandGap(state.actorBand, state.targetBand);
  const actorOlder = gap !== null && gap > 0;
  const actorAdult = isAdultBand(state.actorBand);
  const targetMinor = isMinorBand(state.targetBand);
  const bothSameBand = sameBand(state.actorBand, state.targetBand);
  const total = state.actorMessages + state.targetMessages;
  const initiatorRatio = total === 0 ? 0.5 : state.actorMessages / total;
  const asymmetric = initiatorRatio >= 0.65;

  let weight = d.weight;
  let kind = d.kind;

  switch (d.kind) {
    case "supervision_probe":
      // Peers ask this too. Needs an age gap or a lopsided conversation to stand alone.
      if (!actorOlder && !asymmetric) weight *= 0.3;
      break;

    case "off_platform_migration":
      // Kids swap handles constantly. Weight by age gap and by who asked.
      if (bothSameBand) weight *= 0.35;
      else if (!actorOlder) weight *= 0.6;
      if (d.meta?.concrete_handoff === true) weight *= 1.3;
      break;

    case "economic_bait":
      // Legitimate trading and giveaways are everywhere in game communities.
      // Directionality adult to minor is what makes it a signal.
      if (!(actorAdult && targetMinor)) weight *= actorOlder ? 0.6 : 0.25;
      break;

    case "age_relationship_framing":
      // Teen to teen romance is lawful. Age bands decide.
      if (bothSameBand && isMinorBand(state.actorBand)) weight *= 0.15;
      else if (!actorOlder) weight *= 0.4;
      break;

    case "image_solicitation":
      // Selfie exchange among friends. Combine with stage 3 or 4.
      if (state.firstStageAt.probe === undefined && state.firstStageAt.migrate === undefined) {
        weight *= 0.4;
      }
      if (bothSameBand && isMinorBand(state.actorBand)) weight *= 0.5;
      break;

    case "meetup_logistics":
      // Local friends make plans. The age gap is what makes this critical, so
      // without one it stays a recorded signal but stops forcing a review
      // (see criticalSignalsFor).
      if (!actorOlder || !targetMinor) weight *= 0.3;
      break;

    case "threat_template":
      // Scripts are reused verbatim and almost never appear innocently.
      break;

    case "coercion_nonfinancial":
      // Deliberately not gated on the age gap. Patchin and Hinduja (n=5,568)
      // and Thorn 2025 both find a large share of these accounts are minors
      // themselves, so damping on a missing gap would suppress the pattern
      // exactly where it is most common. The false-positive control is the
      // phrase gating in findCoercionDirective, not a multiplier here. What
      // does raise it is a demand for proof of compliance in the same message.
      if (d.meta?.compliance_demand === true) weight *= 1.2;
      break;

    default:
      break;
  }

  if (state.targetBand === "UNKNOWN" || state.actorBand === "UNKNOWN") weight *= 0.85;

  return { kind, weight };
}

/**
 * Does this hit force tier >= T2? Meetup logistics only counts when the age gap
 * is real, which is why the check needs the pair state and not just the kind.
 */
export function criticalSignalsFor(state: PairState): SignalKind[] {
  const gap = bandGap(state.actorBand, state.targetBand);
  const actorOlder = gap !== null && gap > 0;
  const targetMinor = isMinorBand(state.targetBand);
  const out = new Set<SignalKind>();

  for (const s of state.signals) {
    switch (s.kind) {
      case "threat_template":
      case "payment_after_media":
      case "known_csam_hash":
      // Forces a review the way a payment demand does. The demand is
      // compliance rather than money, so the payment join never sees it
      // (ROADMAP S3).
      case "coercion_nonfinancial":
        out.add(s.kind);
        break;
      case "meetup_logistics":
        if (actorOlder && targetMinor) out.add("meetup_logistics");
        break;
      default:
        break;
    }
  }
  return [...out];
}

export function scorePair(state: PairState, config: PairConfig = {}): PairScoreResult {
  const w = { ...DEFAULT_PAIR_WEIGHTS, ...(config.weights ?? {}) };
  const mode = config.velocityMode ?? "dual";
  const standardWindowMs = config.velocityWindowMs ?? DEFAULT_PAIR_CONFIG.velocityWindowMs;
  const fastWindowMs = config.fastWindowMs ?? DEFAULT_PAIR_CONFIG.fastWindowMs;
  const slowWindowMs = config.slowWindowMs ?? DEFAULT_PAIR_CONFIG.slowWindowMs;

  const ordered = orderedStages(state);
  const prog = progression(ordered);

  const velocityDetail = velocityWindows(state, ordered, {
    mode,
    fastWindowMs,
    slowWindowMs,
    standardWindowMs,
  });
  const vel = chosenVelocity(velocityDetail);
  const asym = asymmetry(state);
  const gapTerm = ageGapMultiplier(state.actorBand, state.targetBand);
  const econ = economicTerm(state);

  const components: PairScoreComponents = {
    progression: round(w.progression * prog.value),
    velocity: round(w.velocity * vel),
    asymmetry: round(w.asymmetry * asym),
    ageGap: round(w.ageGap * gapTerm),
    economic: round(w.economic * econ),
  };

  // The age gap term multiplies the behavioural signal rather than standing on
  // its own. Being an adult in a server full of children is not a signal.
  const behavioural =
    components.progression + components.velocity + components.asymmetry + components.economic;
  const score = round(behavioural * clamp(gapTerm, 0.3, 2.0) + components.ageGap * signum(behavioural));

  const rationale: string[] = [];
  if (prog.transitions.length > 0) {
    rationale.push(`Stage progression observed: ${prog.transitions.join(", ")}.`);
  }
  if (velocityDetail.window !== null && vel > VELOCITY_RATIONALE_FLOOR[velocityDetail.window]) {
    rationale.push(velocitySentence(velocityDetail));
  }
  if (asym > 0.5) {
    rationale.push(
      `Conversation is one-sided: the older account sent ${pct(initiatorRatio(state))} of messages.`,
    );
  }
  if (econ > 0) rationale.push("Money or in-game currency offered toward the younger account.");

  return {
    score,
    components,
    stagesHit: ordered.map((s) => s.stage),
    criticalSignals: criticalSignalsFor(state),
    signals: state.signals,
    hasProgressionPattern: prog.weightedTransitions > 0 || prog.transitions.length >= 2,
    velocityDetail,
    actorBand: state.actorBand,
    targetBand: state.targetBand,
    rationale,
  };
}

/**
 * How large the term has to be before it is worth a sentence in front of a
 * reviewer. The slow window's floor is lower because its rate is per day, so
 * the same walk of the ladder produces a smaller number by construction.
 */
const VELOCITY_RATIONALE_FLOOR: Record<"fast" | "slow" | "standard", number> = {
  fast: 0.5,
  standard: 0.5,
  // A campaign is slow by definition, so its rate is small in the shared unit.
  // The sentence is worth printing for the window it names, not its magnitude.
  slow: 0,
};

interface VelocityWindowOptions {
  mode: "dual" | "single";
  fastWindowMs: number;
  slowWindowMs: number;
  standardWindowMs: number;
}

function velocityWindows(
  state: PairState,
  ordered: OrderedStage[],
  opts: VelocityWindowOptions,
): VelocityDetail {
  const standard = velocity(state, ordered, opts.standardWindowMs);

  if (opts.mode === "single") {
    return {
      fast: 0,
      slow: 0,
      standard,
      window: standard > 0 ? "standard" : null,
      fastWindowMs: opts.fastWindowMs,
      slowWindowMs: opts.slowWindowMs,
      standardWindowMs: opts.standardWindowMs,
    };
  }

  const fast = velocity(state, ordered, opts.fastWindowMs);
  // Every window is read in the same unit, stages per hour. log1p is not scale
  // invariant, so a rate expressed per day and a rate expressed per hour are
  // not comparable numbers: the coarser unit wins by construction for any span
  // over about an hour, which made the fourteen day frame the velocity term for
  // almost every pair. The slow window's floor is a whole day instead, in the
  // shared unit, because a rate cannot be extrapolated from a span far shorter
  // than the window measuring it.
  const slow = velocity(state, ordered, opts.slowWindowMs, HOUR_MS, SLOW_SPAN_FLOOR_HOURS);

  // Which window the stages actually fall inside, not which number came out
  // bigger. Rates measured against different units are not comparable: any
  // speed measure ranks the coarser frame higher, so picking by magnitude
  // would label every sprint a campaign. The fast window is a strict subset of
  // the slow one, so it is tested first and a conversation that walked the
  // ladder inside it is a sprint whatever the arithmetic says.
  let window: VelocityDetail["window"] = null;
  if (countInWindow(state, ordered, opts.fastWindowMs) >= 2) window = "fast";
  else if (countInWindow(state, ordered, opts.slowWindowMs) >= 2) window = "slow";
  else if (standard > 0) window = "standard";

  return {
    fast,
    slow,
    standard,
    window,
    fastWindowMs: opts.fastWindowMs,
    slowWindowMs: opts.slowWindowMs,
    standardWindowMs: opts.standardWindowMs,
  };
}

/**
 * Take the stronger of the terms once a window has fired. All three are stages
 * per hour, so the comparison is between like readings of the same stage times.
 * Keeping the single 24h term in the maximum is what guarantees no conversation
 * scores lower than it did before the second window existed.
 */
function chosenVelocity(detail: VelocityDetail): number {
  if (detail.window === null) return 0;
  return Math.max(detail.fast, detail.slow, detail.standard);
}

function velocitySentence(detail: VelocityDetail): string {
  const hours = (ms: number) => Math.round(ms / 3600000);
  const days = (ms: number) => Math.round(ms / (24 * 3600000));
  if (detail.window === "fast") {
    return `Multiple stages reached within ${hours(detail.fastWindowMs)}h, the fast window.`;
  }
  if (detail.window === "slow") {
    return `Stages accumulated across the ${days(detail.slowWindowMs)} day window rather than in a single session.`;
  }
  return `Multiple stages reached within ${hours(detail.standardWindowMs)}h.`;
}

interface OrderedStage {
  stage: Stage;
  at: number;
}

function orderedStages(state: PairState): OrderedStage[] {
  return Object.entries(state.firstStageAt)
    .filter(([stage]) => stage !== "none")
    .map(([stage, at]) => ({ stage: stage as Stage, at: new Date(at as string).getTime() }))
    .sort((a, b) => a.at - b.at);
}

/**
 * Did they walk the ladder. Consecutive hits in ascending stage order score;
 * probe to migrate and sexualize to coerce count double, because those are the
 * two transitions the case files turn on (DESIGN.md 3, 6.2).
 */
function progression(ordered: OrderedStage[]): {
  value: number;
  transitions: string[];
  weightedTransitions: number;
} {
  const transitions: string[] = [];
  let value = 0;
  let weightedTransitions = 0;

  for (let i = 1; i < ordered.length; i++) {
    const from = ordered[i - 1]!;
    const to = ordered[i]!;
    if (STAGE_INDEX[to.stage] <= STAGE_INDEX[from.stage]) continue;

    const doubled =
      (from.stage === "probe" && to.stage === "migrate") ||
      (from.stage === "sexualize" && to.stage === "coerce");
    value += doubled ? 2 : 1;
    if (doubled) weightedTransitions += 1;
    transitions.push(`${from.stage} to ${to.stage}`);
  }

  // Breadth on its own is worth something, but far less than order.
  value += Math.max(0, ordered.length - 1) * 0.25;
  return { value, transitions, weightedTransitions };
}

/**
 * How fast. DHS notes the whole sequence can compress into minutes.
 *
 * `unitMs` is the reference unit the rate is expressed in. Every window uses
 * stages per hour, which is the DESIGN.md 6.2 behaviour, so that the three
 * readings can be compared to each other at all.
 *
 * `minUnits` is the floor on the denominator, in the same unit. It stops a rate
 * being extrapolated from a span far shorter than the window measuring it:
 * three stages in ninety minutes is not a fourteen day campaign rate.
 */
function velocity(
  state: PairState,
  ordered: OrderedStage[],
  windowMs: number,
  unitMs = 3600000,
  minUnits = 1 / 60,
): number {
  const inWindow = stagesInWindow(state, ordered, windowMs);
  if (inWindow.length < 2) return 0;

  const span = inWindow[inWindow.length - 1]!.at - inWindow[0]!.at;
  const stages = inWindow.length;

  // Same number of stages in an hour is worth more than in a day.
  const units = Math.max(span / unitMs, minUnits);
  const rate = (stages - 1) / units;
  return clamp(Math.log1p(rate) * 1.5, 0, 4);
}

/** The stages whose first hit falls inside `windowMs` of the pair's last activity. */
function stagesInWindow(
  state: PairState,
  ordered: OrderedStage[],
  windowMs: number,
): OrderedStage[] {
  if (ordered.length < 2) return [];
  const end = new Date(state.lastSeenAt ?? ordered[ordered.length - 1]!.at).getTime();
  return ordered.filter((s) => end - s.at <= windowMs);
}

/** How many stages a window can see. The window label turns on this, not on a rate. */
function countInWindow(state: PairState, ordered: OrderedStage[], windowMs: number): number {
  return stagesInWindow(state, ordered, windowMs).length;
}

function initiatorRatio(state: PairState): number {
  const total = state.actorMessages + state.targetMessages;
  return total === 0 ? 0 : state.actorMessages / total;
}

/** Who is driving. One sided plus interrogative is the documented shape. */
function asymmetry(state: PairState): number {
  const total = state.actorMessages + state.targetMessages;
  if (total < 4) return 0;
  const initiator = initiatorRatio(state);
  const questions = state.actorMessages === 0 ? 0 : state.actorQuestions / state.actorMessages;
  const initiatorTerm = clamp((initiator - 0.5) * 2, 0, 1);
  const questionTerm = clamp((questions - 0.25) * 1.5, 0, 1);
  return initiatorTerm + questionTerm;
}

function economicTerm(state: PairState): number {
  const hits = state.signals.filter((s) => s.kind === "economic_bait");
  if (hits.length === 0) return 0;
  const total = hits.reduce((sum, h) => sum + h.weight, 0);
  return clamp(total, 0, 3);
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function signum(value: number): number {
  return value > 0 ? 1 : 0;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
