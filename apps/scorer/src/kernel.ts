import {
  isActorScoreSoleBasis,
  loadLexicon,
  loadScriptCorpus,
  type AgeBand,
  type Event,
  type Lexicon,
  type TierResult,
  type Versions,
} from "@guardian/schema";
import {
  emptyActorState,
  observeActor,
  observeInbound,
  scoreActor,
  scoreFanIn,
  NO_FANIN,
  type FanInSignal,
} from "./actor.js";
import {
  BASE_WEIGHT,
  detectMessage,
  ScriptIndex,
  stageFromDetections,
  type Detection,
} from "./detectors/index.js";
import { fuse, FUSION_VERSION, type FusionThresholds } from "./fusion.js";
import {
  applyMessage,
  emptyPairState,
  hasSeenMessage,
  scorePair,
  type PairMessage,
  type PairState,
} from "./pair.js";
import type { KernelStore } from "./store.js";

/**
 * The detection kernel. It scores an event stream and returns a tier per
 * (actor, target) pair and per actor. It never learns who the customer is
 * beyond an opaque id, which is what lets one model serve a 40 person Discord
 * server and a 2M user game (DESIGN.md 4).
 */

export interface KernelOptions {
  store: KernelStore;
  lexiconVersion?: string;
  corpusVersion?: string;
  modelVersion?: string;
  thresholds?: Partial<FusionThresholds>;
  /** Per-customer lexicon extensions, already merged by the caller. */
  lexiconFor?: (customerId: string) => Lexicon;
}

export interface ScoredEvent {
  result: TierResult;
  detections: Detection[];
  stage: string;
  /** Text kept for the bundle, or null when retention says drop it. */
  excerpts: string[];
  /**
   * True when this externalId had already been folded into the pair. The
   * score is recomputed from the stored state and nothing was mutated, so a
   * retried batch or a redelivered stream entry persists and dispatches the
   * same result rather than a doubled one.
   */
  replay: boolean;
}

export class Kernel {
  private readonly store: KernelStore;
  private readonly lexicon: Lexicon;
  private readonly scripts: ScriptIndex;
  private readonly versions: Versions;
  private readonly thresholds?: Partial<FusionThresholds>;
  private readonly lexiconFor?: (customerId: string) => Lexicon;

  constructor(opts: KernelOptions) {
    this.store = opts.store;
    this.lexicon = loadLexicon(opts.lexiconVersion);
    this.lexiconFor = opts.lexiconFor;
    this.thresholds = opts.thresholds;

    const corpus = loadScriptCorpus(opts.corpusVersion);
    this.scripts = new ScriptIndex();
    for (const script of corpus.scripts) {
      this.scripts.add(script.id, script.label, script.text);
    }

    this.versions = {
      // Phase 1 runs on rules. The stage classifier version replaces this in phase 2.
      modelVersion: opts.modelVersion ?? "rules-v1",
      lexiconVersion: this.lexicon.version,
      fusionVersion: FUSION_VERSION,
    };
  }

  get scriptIndex(): ScriptIndex {
    return this.scripts;
  }

  /**
   * Score one event. Messages with no target are still observed for the actor's
   * graph features, because fan-out in open channels is itself a signal.
   */
  async score(event: Event): Promise<ScoredEvent | null> {
    const lexicon = this.lexiconFor?.(event.customerId) ?? this.lexicon;
    const text = event.text ?? "";

    const { normalized, detections } =
      text.length > 0
        ? detectMessage(text, {
            lexicon,
            scripts: this.scripts,
            actorBand: event.actorBand,
            targetBand: event.targetBand,
          })
        : { normalized: null, detections: [] as Detection[] };

    const isQuestion = /\?/.test(text) || /^(are|do|does|did|who|what|when|where|why|how|can|is)\b/i.test(text.trim());

    // Idempotency on (customer, externalId). Ingest publishes before it
    // appends to the chain and the worker delivers at least once, so the
    // same message can arrive twice. A message the pair has already seen is
    // scored from the stored state and writes nothing: not the pair, not the
    // reverse pair, not the actor's counters.
    const stored = event.targetUid
      ? await this.store.getPair(event.customerId, event.actorUid, event.targetUid)
      : null;
    const replay = stored !== null && hasSeenMessage(stored, event.externalId);

    const actorState = replay
      ? ((await this.store.getActor(event.customerId, event.actorUid)) ?? emptyActorState(event.actorBand))
      : await this.updateActor(event, detections.length > 0);

    if (!event.targetUid) return null;

    // A pair needs both sides. The same message is the sender's own trajectory
    // on (sender, receiver) and the inbound half of (receiver, sender). Without
    // the second write the asymmetry term never sees the child's replies and
    // the payment-after-media join never sees the inbound media.
    if (!replay) await this.applyReverse(event);

    const previous = stored ?? emptyPairState(event.actorBand, event.targetBand);

    // Bands can be filled in later by the customer; always take the latest known value.
    previous.actorBand = preferKnown(previous.actorBand, event.actorBand);
    previous.targetBand = preferKnown(previous.targetBand, event.targetBand);

    const message: PairMessage = {
      externalId: event.externalId,
      ts: event.ts,
      direction: "actor_to_target",
      media: event.media ?? null,
      detections,
      isQuestion,
      channel: event.channel,
    };

    const nextPair = replay ? previous : applyMessage(previous, message);
    if (!replay) await this.store.putPair(event.customerId, event.actorUid, event.targetUid, nextPair);

    // The same event read from the receiving end (ROADMAP S1). observeActor
    // above recorded the sender's fan-out; this records the inbound half on
    // the target, which is what makes fan-IN computable without a second
    // graph. Skipped on a replay so a redelivered message cannot inflate the
    // convergence count.
    //
    // The flag is the gated weight this message put on the pair, not the raw
    // detection count. A detection the pair scorer damped for being same-band,
    // and a mid-weight hit like a giveaway offer, are what ordinary game
    // community traffic looks like; counting either toward convergence is the
    // popular-account false positive guard 3 exists to stop.
    if (!replay) {
      await this.observeTargetInbound(event, carriedFullSignal(nextPair, event.externalId));
    }

    const pairScore = scorePair(nextPair);
    const bannedHints = await this.store.bannedHints(event.customerId);
    const actorScore = scoreActor(event.customerId, event.actorUid, actorState, {
      now: event.ts,
      bannedHints,
    });

    const targetFanIn = await this.targetFanIn(event);
    const fused = fuse({
      pair: pairScore,
      actor: actorScore,
      thresholds: this.thresholds,
      targetFanIn,
    });

    const result: TierResult = {
      tier: fused.tier,
      fusedScore: fused.fusedScore,
      rationale: fused.rationale,
      criticalSignals: fused.criticalSignals,
      pair: {
        customerId: event.customerId,
        actorUid: event.actorUid,
        targetUid: event.targetUid,
        score: pairScore.score,
        components: pairScore.components,
        stagesHit: pairScore.stagesHit,
        criticalSignals: pairScore.criticalSignals,
        signals: pairScore.signals,
        windowStart: new Date(nextPair.firstSeenAt ?? event.ts),
        windowEnd: new Date(nextPair.lastSeenAt ?? event.ts),
      },
      actor: {
        customerId: actorScore.customerId,
        actorUid: actorScore.actorUid,
        skew: actorScore.skew,
        fanOut7d: actorScore.fanOut7d,
        minorFanOut7d: actorScore.minorFanOut7d,
        accountAgeHours: actorScore.accountAgeHours,
        altClusterSize: actorScore.altClusterSize,
        score: actorScore.score,
      },
      versions: this.versions,
      producedBy: "model",
      // Article 5(1)(d) of Regulation (EU) 2024/1689. Recorded per row rather
      // than reconstructed from the fusion code later.
      soleAutomatedBasis: isActorScoreSoleBasis({
        tier: fused.tier,
        pairSignals: pairScore.signals,
        criticalSignals: fused.criticalSignals,
      }),
      suggestedPosture: fused.suggestedPosture,
      supportReferral: fused.supportReferral,
      velocityWindow: fused.velocityWindow,
      fanIn: {
        distinctSources: fused.fanIn.distinctSources,
        convergingSources: fused.fanIn.convergingSources,
        converging: fused.fanIn.converging,
        multiplier: fused.fanIn.multiplier,
      },
      scoredAt: new Date(),
    };

    return {
      result,
      detections,
      stage: stageFromDetections(detections),
      excerpts: detections.map((d) => d.excerpt).filter(Boolean),
      replay,
    };
  }

  /**
   * Record this message as the inbound half of the reverse pair. Detections are
   * deliberately not carried across: what the child said is not the adult's
   * trajectory.
   */
  private async applyReverse(event: Event): Promise<void> {
    if (!event.targetUid) return;
    const stored = await this.store.getPair(event.customerId, event.targetUid, event.actorUid);
    const state = stored ?? emptyPairState(event.targetBand, event.actorBand);
    state.actorBand = preferKnown(state.actorBand, event.targetBand);
    state.targetBand = preferKnown(state.targetBand, event.actorBand);

    const next = applyMessage(state, {
      externalId: event.externalId,
      ts: event.ts,
      direction: "target_to_actor",
      media: event.media ?? null,
      detections: [],
      isQuestion: false,
      channel: event.channel,
    });
    await this.store.putPair(event.customerId, event.targetUid, event.actorUid, next);
  }

  /**
   * Record this event on the target's own actor state as an inbound contact
   * (ROADMAP S1). The target is an actor in its own right; this only touches
   * the inbound list, so nothing here inflates the target's fan-out.
   */
  private async observeTargetInbound(event: Event, flagged: boolean): Promise<void> {
    if (!event.targetUid) return;
    const stored = await this.store.getActor(event.customerId, event.targetUid);
    const state = stored ?? emptyActorState(event.targetBand);
    state.actorBand = preferKnown(state.actorBand, event.targetBand);

    const next = observeInbound(state, {
      ts: event.ts,
      sourceUid: event.actorUid,
      sourceBand: event.actorBand,
      flagged,
    });
    await this.store.putActor(event.customerId, event.targetUid, next);
  }

  /**
   * Convergence on the receiving account, read from the target's stored state.
   * Neutral when the target has no state yet, which is the common case on a
   * first message.
   */
  private async targetFanIn(event: Event): Promise<FanInSignal> {
    if (!event.targetUid) return NO_FANIN;
    const state = await this.store.getActor(event.customerId, event.targetUid);
    // The account being scored is one of the target's inbound sources, so
    // leaving it in would mean a minimum of three sources really asked for two
    // others. Convergence is about the accounts around this pair, not this one.
    return state
      ? scoreFanIn(state, { now: event.ts, excludeUid: event.actorUid })
      : NO_FANIN;
  }

  /** Observe the actor even when there is no pair, so fan-out still accrues. */
  private async updateActor(event: Event, flagged: boolean) {
    const stored = await this.store.getActor(event.customerId, event.actorUid);
    const state = stored ?? emptyActorState(event.actorBand);
    state.actorBand = preferKnown(state.actorBand, event.actorBand);

    const hints = [event.deviceHints?.deviceIdHash, event.deviceHints?.ipHash].filter(
      (h): h is string => typeof h === "string" && h.length > 0,
    );

    const next = observeActor(state, {
      ts: event.ts,
      targetUid: event.targetUid,
      targetBand: event.targetBand,
      flagged,
      accountAgeHours: event.actorAccountAgeHours ?? null,
      role: event.actorRole,
      hints,
    });

    await this.store.putActor(event.customerId, event.actorUid, next);
    return next;
  }

  get versionTriple(): Versions {
    return this.versions;
  }
}

function preferKnown(current: AgeBand, incoming: AgeBand): AgeBand {
  return incoming === "UNKNOWN" ? current : incoming;
}

/**
 * Guard 3 of fan-IN (ROADMAP S1): did this message carry a signal at full
 * strength after gating. `BASE_WEIGHT.high` is the bar because everything
 * under it is either a mid-weight hit, which a giveaway thread produces all
 * day, or a hit the pair scorer already damped for a missing age gap or a
 * same-band pair. Convergence has to mean more than "several accounts said
 * something the lexicon recognises".
 */
function carriedFullSignal(state: PairState, externalId: string): boolean {
  return state.signals.some(
    (s) => s.eventExternalId === externalId && s.weight >= BASE_WEIGHT.high,
  );
}
