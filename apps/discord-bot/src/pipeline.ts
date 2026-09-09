import type { AuditLog } from "@guardian/audit";
import {
  buildEvidenceBundle,
  bundleInputsFor,
  Kernel,
  persistEvidenceBundle,
  persistScoredEvent,
  type BundlePersistClient,
  type EventPersistClient,
  type ScoredEvent,
  type TierRecorder,
} from "@guardian/scorer";
import {
  expiresAt,
  hashUid,
  hashUidOrNull,
  retentionForTier,
  textRetainedForTier,
  reportingIdentityFrom,
  type CustomerReportingIdentity,
  type Event,
  type EvidenceBundle,
  type Tier,
} from "@guardian/schema";
import { decideAction, type BotAction } from "./actions.js";
import { describeError } from "./errors.js";
import { buildModAlert } from "./alerts.js";
import type { GuildConfig } from "./config.js";
import {
  ADJACENCY_WINDOW_MS,
  relayActorUid,
  toEvent,
  type DiscordMessageLike,
  type MemberBand,
  type TargetSource,
} from "./mapping.js";

/**
 * The bot's own pipeline: map, minimize, score, decide, and keep just enough
 * text to build a bundle later.
 *
 * Phase 1 runs the kernel in process rather than over the ingest HTTP edge, so
 * three friendly servers can be onboarded without standing up the platform API.
 * The minimization rules are the same ones the edge applies, so the migration
 * to the SDK path in phase 3 changes the transport and nothing else.
 */

export interface PipelineDeps {
  kernel: Kernel;
  audit: AuditLog;
  customerId: string;
  /** Per-guild salt. Discord ids never reach storage unhashed. */
  idSalt: string;
  /**
   * Who the operator is, for filing. Read once off the customer row at
   * startup rather than joined per bundle, so a bundle records the identity in
   * force when it was generated. Absent means the customer has registered
   * nothing yet, and the bundle reports every field of it empty.
   */
  reportingIdentity?: CustomerReportingIdentity;
  /** How many recent messages per pair to keep for the bundle. */
  timelineDepth?: number;
  /**
   * Where scored events, pair tiers and evidence bundles are written.
   *
   * Absent means nothing is persisted, which is what the bot did for every
   * message it had ever seen: the kernel ran on a MemoryKernelStore, the chain
   * on a MemoryAuditStore, and nothing wrote the evidence_bundles table at all.
   * The mod channel got an embed and the reviewer console stayed empty, because
   * `getTimeline` in apps/review reads that table and only that table. So the
   * two halves of the product had never been connected in a running process.
   *
   * A restart also forgot every trajectory, which is the state a grooming
   * detector exists to accumulate.
   */
  persistence?: Persistence | null;
}

export interface Persistence {
  db: EventPersistClient & BundlePersistClient;
  store: TierRecorder;
}

interface TimelineRow {
  ts: Date;
  channel: string;
  direction: "actor_to_target" | "target_to_actor";
  text: string | null;
  stage: string | null;
  signals: string[];
}

export interface HandleResult {
  scored: ScoredEvent | null;
  tier: Tier;
  action: BotAction;
  alert: string | null;
  refusal?: string;
  /**
   * How the pair was arrived at: a reply, a mention, or Guardian inferring it
   * because these two were the only people talking in the channel. A case built
   * on the third is a weaker claim than one built on the first two.
   */
  targetSource?: TargetSource | null;
}

export class BotPipeline {
  /**
   * Retained message rows, keyed by guild and then by pair. One process serves
   * every guild under one customer id and one salt, so the same two Discord
   * ids produce the same pair key in every server; the guild has to be part of
   * the key or a bundle exported in one server could carry another server's
   * messages (CLAUDE.md rule 8).
   */
  private readonly timelines = new Map<string, TimelineRow[]>();
  /** Hashed uid to the Discord id, held in memory only so an alert can @ them. */
  private readonly displayIds = new Map<string, string>();

  /**
   * Who has spoken in each channel lately, so a message that is neither a reply
   * nor a mention can still find its partner.
   *
   * Unhashed Discord ids and message timestamps, nothing else, trimmed to the
   * adjacency window on every read. No text: this is a list of who was in the
   * room, not what was said in it.
   */
  private readonly recentByChannel = new Map<string, Array<{ uid: string; at: number }>>();

  constructor(private readonly deps: PipelineDeps) {}

  async handle(
    msg: DiscordMessageLike,
    config: GuildConfig,
    memberBands: (userId: string) => MemberBand,
    now = new Date(),
  ): Promise<HandleResult> {
    /*
     * The speaker, not the account that posted.
     *
     * On a webhook relay every message carries the webhook's id as its author,
     * so keying the channel roster on authorId made a whole bridged
     * conversation look like one person talking to themselves and adjacency
     * found nobody. relayActorUid is the same identity toEvent puts on the
     * event, so the roster and the pair agree about who is in the room.
     */
    const speaker = relayActorUid(msg);
    const others = this.recentOthers(msg.channelId, speaker, msg.createdAt);
    const mapped = toEvent(msg, config, memberBands, now, others);
    // Recorded whether or not the message maps: a refused message still tells
    // the next one who was in the channel.
    this.rememberSpeaker(msg.channelId, speaker, msg.createdAt);
    if (!mapped.ok) {
      return { scored: null, tier: "T0", action: { kind: "none" }, alert: null, refusal: mapped.refusal };
    }

    const inbound = mapped.event;
    // toEvent refuses a message with no guild, so this is always the guild id.
    const guildId = inbound.provenance.sourceId;
    const actorUid = hashUid(inbound.actorUid, this.deps.idSalt);
    const targetUid = hashUidOrNull(inbound.targetUid, this.deps.idSalt);
    this.displayIds.set(actorUid, inbound.actorUid);
    if (targetUid && inbound.targetUid) this.displayIds.set(targetUid, inbound.targetUid);

    const retention = retentionForTier("T0");
    const event: Event = {
      ...inbound,
      customerId: this.deps.customerId,
      actorUid,
      targetUid,
      media: inbound.media ?? null,
      actorAccountAgeHours: inbound.actorAccountAgeHours ?? null,
      deviceHints: inbound.deviceHints ?? null,
      text: inbound.text ?? null,
      // How the surface knows these two were talking, so a reviewer about to
      // file can tell a reply from a guess (ROADMAP 2b.3).
      targetSource: mapped.targetSource,
      retention,
      expiresAt: expiresAt(retention, inbound.ts) ?? new Date(inbound.ts.getTime() + 86_400_000),
    };

    const scored = await this.deps.kernel.score(event);
    if (!scored || !targetUid) {
      // Reported even here, so a caller always learns how the target was
      // resolved, including that it was not resolved at all.
      return {
        scored: null,
        tier: "T0",
        action: { kind: "none" },
        alert: null,
        targetSource: mapped.targetSource,
      };
    }

    const tier = scored.result.tier;

    /*
     * The event row and the pair tier, so a restart does not forget the
     * trajectory and the reviewer console has a case to open. A persistence
     * failure must not cost the mod-channel alert: the operator's own guard is
     * the thing standing between this message and the next one, and it does not
     * depend on Guardian's database being reachable.
     */
    if (this.deps.persistence) {
      const { db, store } = this.deps.persistence;
      try {
        await persistScoredEvent(db, store, event, scored);
      } catch (err) {
        console.error(`guardian persist failed for ${event.externalId}:`, describeError(err));
      }
    }
    this.remember(guildId, actorUid, targetUid, {
      ts: inbound.ts,
      channel: inbound.channel,
      direction: "actor_to_target",
      // T0 keeps features only. Raw text is not held for a pair that scored nothing.
      text: textRetainedForTier(tier) ? (inbound.text ?? null) : null,
      stage: scored.stage,
      signals: scored.detections.map((d) => d.kind),
    });

    // ROADMAP S4. The posture decides whether friction is applied at all and
    // whether the card carries the removal route, so both consumers read it.
    const posture = scored.result.suggestedPosture ?? "enforcement";
    const action = decideAction(tier, config, posture);
    const alert =
      action.kind === "none"
        ? null
        : buildModAlert({
            tier,
            actorId: inbound.actorUid,
            targetId: inbound.targetUid ?? "unknown",
            channelId: inbound.channel,
            rationale: scored.result.rationale,
            criticalSignals: scored.result.criticalSignals,
            stagesHit: scored.result.pair.stagesHit,
            posture,
            supportReferral: scored.result.supportReferral ?? null,
          });

    if (action.kind !== "none") {
      await this.deps.audit.append({
        kind: "score.assigned",
        customerId: this.deps.customerId,
        payload: {
          actorUid,
          targetUid,
          tier,
          fusedScore: scored.result.fusedScore,
          criticalSignals: scored.result.criticalSignals,
          versions: scored.result.versions,
          action: action.kind,
          suggestedPosture: posture,
        },
      });
    }

    /*
     * A bundle for anything the model put at T1 or above, so the case a
     * reviewer opens carries the conversation rather than an empty timeline.
     * Written after the alert, for the same reason the event row is: a bundle
     * that failed to write is a case with no excerpts, and a mod channel that
     * was not told is a message nobody saw.
     */
    if (this.deps.persistence && tier !== "T0") {
      await this.persistBundle(guildId, actorUid, targetUid, tier, scored.result.rationale);
    }

    return { scored, tier, action, alert, targetSource: mapped.targetSource };
  }

  /**
   * The other accounts that have spoken in this channel inside the window.
   *
   * Trimmed on read rather than on a timer, so a quiet channel costs nothing and
   * a process that has been up for a week is not holding last Tuesday's roster.
   */
  private recentOthers(channelId: string, authorId: string, at: Date): string[] {
    const seen = this.recentByChannel.get(channelId);
    if (!seen) return [];
    const floor = at.getTime() - ADJACENCY_WINDOW_MS;
    const live = seen.filter((entry) => entry.at >= floor);
    this.recentByChannel.set(channelId, live);
    return live.filter((entry) => entry.uid !== authorId).map((entry) => entry.uid);
  }

  private rememberSpeaker(channelId: string, authorId: string, at: Date): void {
    const seen = this.recentByChannel.get(channelId) ?? [];
    const floor = at.getTime() - ADJACENCY_WINDOW_MS;
    const live = seen.filter((entry) => entry.at >= floor && entry.uid !== authorId);
    live.push({ uid: authorId, at: at.getTime() });
    this.recentByChannel.set(channelId, live);
  }

  /** Build and store the bundle for a pair the model has put in scope. */
  private async persistBundle(
    guildId: string,
    actorUid: string,
    targetUid: string,
    tier: Tier,
    rationale: string[],
  ): Promise<void> {
    const persistence = this.deps.persistence;
    if (!persistence) return;
    try {
      const bundle = await this.buildBundle(guildId, actorUid, targetUid, tier);
      if (!bundle) return;
      await persistEvidenceBundle(persistence.db, bundle);
      void rationale;
    } catch (err) {
      console.error(`guardian bundle persist failed for ${actorUid}:`, describeError(err));
    }
  }

  /**
   * Build the bundle the owner takes to report.cybertip.org. Anchored to the
   * audit head at export time and recorded as an export in the chain.
   *
   * The guild is the first argument because it is part of the lookup, not a
   * label: rows scored in another server are not reachable from here. Returns
   * null when this guild has no retained rows for the pair, so an export can
   * never fall back to a bundle built from somewhere else.
   */
  async exportBundle(
    guildId: string,
    actorUid: string,
    targetUid: string,
    tier: Tier,
    rationale: string[],
  ): Promise<EvidenceBundle | null> {
    const bundle = await this.buildBundle(guildId, actorUid, targetUid, tier);
    if (!bundle) return null;

    await this.deps.audit.append({
      kind: "bundle.exported",
      customerId: this.deps.customerId,
      payload: {
        bundleId: bundle.bundleId,
        actorUid,
        targetUid,
        tier,
        messages: bundle.timeline.length,
        rationale,
      },
    });

    return bundle;
  }

  /**
   * The bundle for one pair in one guild, from the rows this process retained.
   *
   * Returns null when this guild has no retained rows for the pair, so a bundle
   * can never fall back to one built from somewhere else (CLAUDE.md rule 8).
   */
  private async buildBundle(
    guildId: string,
    actorUid: string,
    targetUid: string,
    tier: Tier,
  ): Promise<EvidenceBundle | null> {
    const rows = this.timelines.get(pairKey(guildId, actorUid, targetUid));
    if (!rows || rows.length === 0) return null;
    const head = await this.deps.audit.head();

    return buildEvidenceBundle({
      customerId: this.deps.customerId,
      actorUid,
      targetUid,
      tier,
      timeline: rows.map((r) => ({
        ts: r.ts,
        channel: r.channel,
        direction: r.direction,
        text: r.text,
        mediaSha256: null,
        knownCsamVerdict: null,
        stage: (r.stage ?? null) as never,
        signals: r.signals as never,
      })),
      signals: [],
      versions: this.deps.kernel.versionTriple,
      provenance: [{ surface: "discord", sourceId: guildId }],
      auditHead: head.hash,
      ...bundleInputsFor(this.deps.reportingIdentity ?? reportingIdentityFrom({})),
    });
  }

  displayIdFor(hashedUid: string): string | null {
    return this.displayIds.get(hashedUid) ?? null;
  }

  private remember(guildId: string, actorUid: string, targetUid: string, row: TimelineRow): void {
    const key = pairKey(guildId, actorUid, targetUid);
    const rows = this.timelines.get(key) ?? [];
    rows.push(row);
    const depth = this.deps.timelineDepth ?? 50;
    this.timelines.set(key, rows.slice(-depth));
  }
}

function pairKey(guildId: string, actorUid: string, targetUid: string): string {
  return `${guildId}:${actorUid}:${targetUid}`;
}
