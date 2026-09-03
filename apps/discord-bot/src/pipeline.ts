import type { AuditLog } from "@guardian/audit";
import {
  buildEvidenceBundle,
  Kernel,
  type ScoredEvent,
} from "@guardian/scorer";
import {
  expiresAt,
  hashUid,
  hashUidOrNull,
  retentionForTier,
  textRetainedForTier,
  type AgeBand,
  type Event,
  type EvidenceBundle,
  type Tier,
} from "@guardian/schema";
import { decideAction, type BotAction } from "./actions.js";
import { buildModAlert } from "./alerts.js";
import type { GuildConfig } from "./config.js";
import { toEvent, type DiscordMessageLike } from "./mapping.js";

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
  /** How many recent messages per pair to keep for the bundle. */
  timelineDepth?: number;
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
}

export class BotPipeline {
  private readonly timelines = new Map<string, TimelineRow[]>();
  /** Hashed uid to the Discord id, held in memory only so an alert can @ them. */
  private readonly displayIds = new Map<string, string>();

  constructor(private readonly deps: PipelineDeps) {}

  async handle(
    msg: DiscordMessageLike,
    config: GuildConfig,
    memberBands: (userId: string) => AgeBand,
    now = new Date(),
  ): Promise<HandleResult> {
    const mapped = toEvent(msg, config, memberBands, now);
    if (!mapped.ok) {
      return { scored: null, tier: "T0", action: { kind: "none" }, alert: null, refusal: mapped.refusal };
    }

    const inbound = mapped.event;
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
      retention,
      expiresAt: expiresAt(retention, inbound.ts) ?? new Date(inbound.ts.getTime() + 86_400_000),
    };

    const scored = await this.deps.kernel.score(event);
    if (!scored || !targetUid) {
      return { scored: null, tier: "T0", action: { kind: "none" }, alert: null };
    }

    const tier = scored.result.tier;
    this.remember(actorUid, targetUid, {
      ts: inbound.ts,
      channel: inbound.channel,
      direction: "actor_to_target",
      // T0 keeps features only. Raw text is not held for a pair that scored nothing.
      text: textRetainedForTier(tier) ? (inbound.text ?? null) : null,
      stage: scored.stage,
      signals: scored.detections.map((d) => d.kind),
    });

    const action = decideAction(tier, config);
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
        },
      });
    }

    return { scored, tier, action, alert };
  }

  /**
   * Build the bundle the owner takes to report.cybertip.org. Anchored to the
   * audit head at export time and recorded as an export in the chain.
   */
  async exportBundle(
    actorUid: string,
    targetUid: string,
    tier: Tier,
    guildId: string,
    rationale: string[],
  ): Promise<EvidenceBundle> {
    const head = await this.deps.audit.head();
    const rows = this.timelines.get(pairKey(actorUid, targetUid)) ?? [];

    const bundle = buildEvidenceBundle({
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
    });

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

  displayIdFor(hashedUid: string): string | null {
    return this.displayIds.get(hashedUid) ?? null;
  }

  private remember(actorUid: string, targetUid: string, row: TimelineRow): void {
    const key = pairKey(actorUid, targetUid);
    const rows = this.timelines.get(key) ?? [];
    rows.push(row);
    const depth = this.deps.timelineDepth ?? 50;
    this.timelines.set(key, rows.slice(-depth));
  }
}

function pairKey(actorUid: string, targetUid: string): string {
  return `${actorUid}:${targetUid}`;
}
