import {
  loadLexicon,
  loadScriptCorpus,
  type AgeBand,
  type Event,
  type Lexicon,
  type TierResult,
  type Versions,
} from "@guardian/schema";
import { emptyActorState, observeActor, scoreActor } from "./actor.js";
import { detectMessage, ScriptIndex, stageFromDetections, type Detection } from "./detectors/index.js";
import { fuse, FUSION_VERSION, type FusionThresholds } from "./fusion.js";
import { applyMessage, emptyPairState, hasSeenMessage, scorePair, type PairMessage } from "./pair.js";
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

    const pairScore = scorePair(nextPair);
    const bannedHints = await this.store.bannedHints(event.customerId);
    const actorScore = scoreActor(event.customerId, event.actorUid, actorState, {
      now: event.ts,
      bannedHints,
    });

    const fused = fuse({ pair: pairScore, actor: actorScore, thresholds: this.thresholds });

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
