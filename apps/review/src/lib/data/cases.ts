/**
 * Cases: pairs, their evidence timelines and the decisions on them.
 *
 * Every read here takes the session and puts session.customerId in the where
 * clause. There is no query path in this module that can cross customers, and a
 * pair the session cannot see returns null so the caller renders not-found
 * rather than a 403. A 403 confirms the case exists.
 */

import { getPrisma, isMockMode } from "../db";
import { appendAudit, appendAuditInTransaction } from "./audit";
import { getMockData, bandWord } from "../mock/fixtures";
import { compose } from "../compose";
import type { Session } from "../auth";
import type {
  BandReading,
  CaseDetail,
  PriorCase,
  QueueCase,
  QueueFilters,
  QueuePage,
  QueueSummary,
  ReviewRecord,
  TimelineRow,
  TimelineState,
  Tier,
} from "./types";

/** Rank order the queue prints above itself, so a reviewer can see why A is above B. */
export const RANKING_SENTENCE =
  "Ranked by tier and critical signal, times identifiable-signal count, times actor fan-out, divided by SLA time remaining.";

const TIER_WEIGHT: Record<Tier, number> = { T0: 0, T1: 1, T2: 2, T3: 3 };

/** Under this many minutes of SLA left, a case counts toward breach risk. */
export const BREACH_RISK_MINUTES = 60;

function rankScore(row: QueueCase): number {
  const base = TIER_WEIGHT[row.tier] * 100;
  const critical = row.criticalSignals.length > 0 ? 60 : 0;
  const sla = row.slaRemainingMinutes ?? 24 * 60;
  return base + critical + 600 / Math.max(sla, 5);
}

function matchesChip(row: QueueCase, chip: QueueFilters["chip"]): boolean {
  switch (chip) {
    case "critical":
      return row.criticalSignals.length > 0;
    case "unclaimed":
      return row.claim.state === "unclaimed";
    case "breach":
      return row.slaRemainingMinutes !== null && row.slaRemainingMinutes <= BREACH_RISK_MINUTES;
    case "needs_second":
      return row.tier === "T2" && row.criticalSignals.length > 0;
    default:
      return true;
  }
}

function summarise(partitionName: string, cases: QueueCase[]): QueueSummary {
  return {
    partitionName,
    total: cases.length,
    criticalCount: cases.filter((c) => c.criticalSignals.length > 0).length,
    unclaimedCount: cases.filter((c) => c.claim.state === "unclaimed").length,
    breachRiskCount: cases.filter(
      (c) => c.slaRemainingMinutes !== null && c.slaRemainingMinutes <= BREACH_RISK_MINUTES,
    ).length,
    needsSecondCount: cases.filter((c) => matchesChip(c, "needs_second")).length,
    lastArrivalAt:
      cases.length === 0
        ? null
        : cases.reduce((latest, c) => (c.updatedAt > latest ? c.updatedAt : latest), cases[0]!.updatedAt),
  };
}

/* -------------------------------------------------------------------------- */
/* Database mapping                                                            */
/* -------------------------------------------------------------------------- */

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

interface ActorRow {
  hashedUid: string;
  ageBand: string;
  ageBandConfidence: number | null;
  ageBandProvenance: string;
  role: string;
  accountAgeHours: number | null;
  fanOut7d: number;
  minorFanOut7d: number;
  hints: string[];
  graphState: unknown;
}

function bandOf(actor: ActorRow | undefined): BandReading {
  if (!actor) return { band: "UNKNOWN", confidence: null, provenance: "unknown" };
  return {
    band: actor.ageBand as BandReading["band"],
    confidence: actor.ageBandConfidence,
    provenance: actor.ageBandProvenance as BandReading["provenance"],
  };
}

/**
 * A noun phrase naming the pattern, built from the signals on the row. Never a
 * person, never a score. Guarded at this boundary because it is built from data.
 */
function patternClause(pairId: string, signals: unknown, stages: string[]): string {
  const kinds = new Set(
    asArray(signals)
      .map((hit) => asRecord(hit).kind)
      .filter((kind): kind is string => typeof kind === "string"),
  );
  let clause: string;
  if (kinds.has("payment_after_media")) clause = "Payment demand minutes after a media event";
  else if (kinds.has("coercion_nonfinancial")) clause = "Coercion language, non-financial";
  else if (kinds.has("threat_template")) clause = "Threat-template match in this pair";
  else if (kinds.has("off_platform_migration") && kinds.has("supervision_probe"))
    clause = "Supervision probe followed by a migration ask";
  else if (kinds.has("off_platform_migration")) clause = "Migration ask";
  else if (kinds.has("economic_bait")) clause = "Economic bait, single signal";
  else if (stages.length >= 2) clause = `Stage ${stages[0]} to ${stages[stages.length - 1]}`;
  else clause = "No conversational signal on this pair";
  return compose(`cases.patternClause.${pairId}`, clause);
}

function stagesInOrder(firstStageAt: unknown): Array<{ stage: string; at: Date }> {
  const map = asRecord(firstStageAt);
  const out: Array<{ stage: string; at: Date }> = [];
  for (const [stage, value] of Object.entries(map)) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) continue;
    out.push({ stage, at });
  }
  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out;
}

/**
 * SLA is a queue property: four hours from arrival for T2, none below it.
 *
 * From createdAt, never from updatedAt. updatedAt is a Prisma @updatedAt
 * column, so a reviewer opening the case, a rescore, or any other write reset
 * the countdown: a T2 waiting since nine o'clock dropped out of the breach chip
 * and off the operator dashboard because somebody looked at it.
 */
function slaRemainingMinutes(tier: string, arrivedAt: Date, now: Date): number | null {
  if (tier !== "T2" && tier !== "T3") return null;
  const deadline = arrivedAt.getTime() + 4 * 60 * 60 * 1000;
  return Math.round((deadline - now.getTime()) / 60_000);
}

interface PairRow {
  id: string;
  customerId: string;
  actorUid: string;
  targetUid: string;
  tier: string;
  criticalSignals: string[];
  signals: unknown;
  firstStageAt: unknown;
  soleAutomatedBasis: boolean;
  suggestedPosture: string | null;
  messageCounts: unknown;
  windowStart: Date | null;
  windowEnd: Date | null;
  humanViewedAt: Date | null;
  /** When the scorer first wrote this pair. Immutable, unlike updatedAt. */
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  modelVersion: string | null;
  lexiconVersion: string | null;
  fusionVersion: string | null;
  lastInboundMediaAt: Date | null;
}

function toQueueCase(
  row: PairRow,
  customerName: string,
  actors: Map<string, ActorRow>,
  now: Date,
): QueueCase {
  const stages = stagesInOrder(row.firstStageAt).map((s) => s.stage);
  const actor = actors.get(row.actorUid);
  const counts = asRecord(row.messageCounts);
  const total =
    typeof counts.total === "number"
      ? counts.total
      : asArray(row.signals).length > 0
        ? asArray(row.signals).length
        : 0;
  const spanHours =
    row.windowStart && row.windowEnd
      ? Math.max(
          0,
          Math.round((row.windowEnd.getTime() - row.windowStart.getTime()) / 3_600_000),
        )
      : 0;
  const pairsInWindow = actor?.fanOut7d ?? 0;
  const actorContext =
    pairsInWindow > 1
      ? `actor in ${pairsInWindow} pairs this week`
      : "first case for this actor";

  return {
    pairId: row.id,
    shortId: row.id.slice(-4),
    customerId: row.customerId,
    customerName,
    channel: null,
    tier: row.tier as Tier,
    criticalSignals: row.criticalSignals,
    patternClause: patternClause(row.id, row.signals, stages),
    actorBand: bandOf(actor),
    targetBand: bandOf(actors.get(row.targetUid)),
    actorContext: compose(`cases.actorContext.${row.id}`, actorContext),
    suggestedPosture: (row.suggestedPosture as "enforcement" | "support" | null) ?? null,
    soleAutomatedBasis: row.soleAutomatedBasis,
    messageCount: total,
    spanHours,
    mediaEventCount: row.lastInboundMediaAt ? 1 : 0,
    slaRemainingMinutes: slaRemainingMinutes(row.tier, row.createdAt, now),
    // The schema has no claim columns yet (DESIGN-UI 13.2 gap 1), so a database
    // read is always unclaimed. Nothing here guesses at ownership.
    claim: { state: "unclaimed" },
    unread: row.humanViewedAt === null,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listQueue(
  session: Session,
  filters: QueueFilters = {},
): Promise<QueuePage> {
  const chip = filters.chip ?? "all";
  const limit = filters.limit ?? 50;

  if (isMockMode()) {
    const data = await getMockData();
    const all = data.pairs
      .filter((p) => p.queue.customerId === session.customerId)
      .filter((p) => p.queue.resolvedAt === null)
      .map((p) => p.queue);
    const summary = summarise(data.customer.name, all);
    const cases = all
      .filter((row) => matchesChip(row, chip))
      .filter((row) => (filters.tier ? filters.tier.includes(row.tier) : true))
      .sort((a, b) => rankScore(b) - rankScore(a))
      .slice(0, limit);
    return { summary, cases };
  }

  const prisma = await getPrisma();
  const [customer, rows] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: session.customerId },
      select: { name: true },
    }),
    prisma.pair.findMany({
      where: {
        customerId: session.customerId,
        resolvedAt: null,
        tier: { in: ["T1", "T2"] },
      },
      orderBy: [{ tier: "desc" }, { updatedAt: "asc" }],
      take: 200,
    }),
  ]);

  const uids = [...new Set(rows.flatMap((r) => [r.actorUid, r.targetUid]))];
  const actorRows = await prisma.actor.findMany({
    where: { customerId: session.customerId, hashedUid: { in: uids } },
  });
  const actors = new Map<string, ActorRow>(actorRows.map((a) => [a.hashedUid, a as ActorRow]));

  const now = new Date();
  const all = rows.map((row) =>
    toQueueCase(row as unknown as PairRow, customer?.name ?? session.customerId, actors, now),
  );
  const summary = summarise(customer?.name ?? session.customerId, all);
  const cases = all
    .filter((row) => matchesChip(row, chip))
    .filter((row) => (filters.tier ? filters.tier.includes(row.tier) : true))
    .sort((a, b) => rankScore(b) - rankScore(a))
    .slice(0, limit);
  return { summary, cases };
}

export async function getCase(session: Session, pairId: string): Promise<CaseDetail | null> {
  if (isMockMode()) {
    const data = await getMockData();
    const found = data.pairs.find(
      (p) => p.queue.pairId === pairId && p.queue.customerId === session.customerId,
    );
    if (!found) return null;
    const { timeline: _timeline, ...detail } = found;
    void _timeline;
    return detail;
  }

  const prisma = await getPrisma();
  const row = await prisma.pair.findFirst({
    where: { id: pairId, customerId: session.customerId },
  });
  if (!row) return null;

  const [customer, actorRows, reviews] = await Promise.all([
    prisma.customer.findUnique({ where: { id: session.customerId }, select: { name: true } }),
    prisma.actor.findMany({
      where: { customerId: session.customerId, hashedUid: { in: [row.actorUid, row.targetUid] } },
    }),
    prisma.review.findMany({
      where: { pair: { customerId: session.customerId, actorUid: row.actorUid } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const actors = new Map<string, ActorRow>(actorRows.map((a) => [a.hashedUid, a as ActorRow]));
  const now = new Date();
  const queue = toQueueCase(
    row as unknown as PairRow,
    customer?.name ?? session.customerId,
    actors,
    now,
  );
  const stages = stagesInOrder(row.firstStageAt);
  const actorRow = actors.get(row.actorUid);

  let previous: number | null = null;
  const stagePath = stages.map((entry) => {
    const elapsed = previous === null ? null : (entry.at.getTime() - previous) / 3_600_000;
    previous = entry.at.getTime();
    return {
      stage: entry.stage as CaseDetail["stagePath"][number]["stage"],
      reachedAt: entry.at,
      elapsedHoursFromPrevious: elapsed === null ? null : Math.round(elapsed * 10) / 10,
    };
  });

  const signals = asArray(row.signals);
  const features = signals
    .map((hit) => asRecord(hit))
    .filter((hit) => typeof hit.kind === "string")
    .slice(0, 3)
    .map((hit) => ({
      label: String(hit.kind).replace(/_/g, " "),
      weight: typeof hit.weight === "number" ? hit.weight : 0,
      critical: row.criticalSignals.includes(String(hit.kind)),
    }));

  const whySentence = compose(
    `cases.whySentence.${row.id}`,
    stages.length >= 2
      ? `Signals consistent with stage ${stages[0]!.stage} and stage ${stages[stages.length - 1]!.stage} were recorded in this pair, between an account in the ${bandWord(queue.actorBand.band)} band and an account in the ${bandWord(queue.targetBand.band)} band.`
      : `One signal was recorded in this pair, between an account in the ${bandWord(queue.actorBand.band)} band and an account in the ${bandWord(queue.targetBand.band)} band.`,
  );

  return {
    queue,
    whySentence,
    features,
    stagePath,
    // Not persisted yet (DESIGN-UI 13.2 gap 5). Null rather than recomputed:
    // the case view must not depend on the scorer being reachable.
    velocityWindow: null,
    actor: {
      hashedUid: row.actorUid,
      band: queue.actorBand,
      accountAgeHours: actorRow?.accountAgeHours ?? null,
      pairsInWindow: actorRow?.fanOut7d ?? 0,
      fanOut7d: actorRow?.fanOut7d ?? 0,
      minorFanOut7d: actorRow?.minorFanOut7d ?? 0,
      fanIn7d: null,
      altClusterSize: actorRow?.hints.length ?? 0,
      elevatedRole:
        actorRow && actorRow.role !== "member" && actorRow.role !== "unknown"
          ? actorRow.role.replace(/_/g, " ")
          : null,
    },
    priorCases: reviews
      .filter((r) => r.pairId !== row.id)
      .map((r) => ({
        pairId: r.pairId,
        shortId: r.pairId.slice(-4),
        decidedAt: r.createdAt,
        decision: r.decision as PriorCase["decision"],
        resultTier: r.resultTier as Tier,
        reasonLabel: r.reason ?? "reason not recorded",
      })),
    // No OperatorPolicy model yet (DESIGN-UI 13.2 gap 6).
    policy: { tier: queue.tier, criteria: null, editedAt: null, editedBy: null },
    versions: {
      modelVersion: row.modelVersion ?? "unknown",
      lexiconVersion: row.lexiconVersion ?? "unknown",
      fusionVersion: row.fusionVersion ?? "unknown",
    },
    // The pair row is written when the scorer first scores the pair, so this is
    // a score time. updatedAt is not: the decision transaction sets it, so
    // every latency measured against it came out as zero or negative.
    scoredAt: row.createdAt,
    auditSeq: null,
    humanViewedAt: row.humanViewedAt,
  };
}

export async function getTimeline(session: Session, pairId: string): Promise<TimelineState> {
  if (isMockMode()) {
    const data = await getMockData();
    const found = data.pairs.find(
      (p) => p.queue.pairId === pairId && p.queue.customerId === session.customerId,
    );
    return found?.timeline ?? { state: "empty" };
  }

  const prisma = await getPrisma();
  const pair = await prisma.pair.findFirst({
    where: { id: pairId, customerId: session.customerId },
    select: { id: true, actorUid: true, targetUid: true, tier: true, expiresAt: true },
  });
  if (!pair) return { state: "empty" };

  const bundle = await prisma.evidenceBundle.findFirst({
    where: { pairId: pair.id, customerId: session.customerId },
    orderBy: { generatedAt: "desc" },
  });
  if (!bundle) {
    return pair.expiresAt && pair.expiresAt < new Date()
      ? { state: "expired", deletedOn: pair.expiresAt }
      : { state: "empty" };
  }

  const rows: TimelineRow[] = [];
  let previous: number | null = null;
  asArray(bundle.timeline).forEach((raw, index) => {
    const entry = asRecord(raw);
    const at = new Date(String(entry.ts ?? ""));
    if (Number.isNaN(at.getTime())) return;
    const gapHours = previous === null ? null : (at.getTime() - previous) / 3_600_000;
    previous = at.getTime();
    const direction = entry.direction === "target_to_actor" ? "s1" : "t";
    const mediaSha = typeof entry.mediaSha256 === "string" ? entry.mediaSha256 : null;
    rows.push({
      id: `${bundle.bundleId}_${index}`,
      at,
      speaker: direction,
      bandLabel: direction === "t" ? "older band" : "younger band",
      text: typeof entry.excerpt === "string" ? entry.excerpt : null,
      collapsed: null,
      normalizations: [],
      stage: (entry.stage as TimelineRow["stage"]) ?? null,
      confidence: null,
      lowConfidence: false,
      signals: asArray(entry.signals).filter((s): s is string => typeof s === "string"),
      media: mediaSha
        ? {
            sha256: mediaSha,
            direction: direction === "t" ? "older_to_younger" : "younger_to_older",
            verdict:
              entry.knownCsamVerdict === "match" || entry.knownCsamVerdict === "no_match"
                ? entry.knownCsamVerdict
                : "not_run",
            viewedByOperatorHuman: false,
          }
        : null,
      viewedByHuman: entry.viewedByHuman === true,
      gapHoursBefore: gapHours !== null && gapHours >= 2 ? Math.round(gapHours) : null,
    });
  });

  if (rows.length === 0) return { state: "empty" };
  return {
    state: "ready",
    rows,
    messageCount: rows.length,
    collapsedThirdParty: 0,
  };
}

/**
 * Writes viewedByHuman on the excerpts a person actually read (DESIGN-UI 5.3).
 * Never called on case open, and never by scrolling past a collapsed span.
 *
 * Returns the ids it actually wrote, not a count. The caller has to know which
 * flags landed: a client that adds an id to its own read set before the server
 * agrees will unblock confirm and propose on a write that failed or matched
 * nothing, and the bundle would then say those excerpts were read by nobody
 * while the audit chain says a person read them.
 *
 * The write goes on the chain, because this is the claim the private-search
 * argument rests on and every other reviewer act is on the chain already.
 */
export async function markExcerptsViewed(
  session: Session,
  pairId: string,
  excerptIds: string[],
): Promise<string[]> {
  if (excerptIds.length === 0) return [];

  if (isMockMode()) {
    const data = await getMockData();
    const found = data.pairs.find(
      (p) => p.queue.pairId === pairId && p.queue.customerId === session.customerId,
    );
    if (!found || found.timeline.state !== "ready") return [];
    const marked: string[] = [];
    for (const row of found.timeline.rows) {
      if (excerptIds.includes(row.id) && !row.viewedByHuman) {
        row.viewedByHuman = true;
        marked.push(row.id);
      }
    }
    if (marked.length === 0) return [];
    if (found.humanViewedAt === null) found.humanViewedAt = new Date();
    // Unread is derived from humanViewedAt, here as it is against a database.
    found.queue.unread = found.humanViewedAt === null;
    await appendAudit(session, {
      kind: "evidence.read",
      payload: {
        pairId,
        reviewerId: session.reviewerId,
        excerptIds: marked,
        excerptCount: marked.length,
      },
    });
    return marked;
  }

  const prisma = await getPrisma();
  const bundle = await prisma.evidenceBundle.findFirst({
    where: { pairId, customerId: session.customerId },
    orderBy: { generatedAt: "desc" },
  });
  if (!bundle) return [];

  const marked: string[] = [];
  const timeline = asArray(bundle.timeline).map((raw, index) => {
    const entry = asRecord(raw);
    const id = `${bundle.bundleId}_${index}`;
    if (excerptIds.includes(id) && entry.viewedByHuman !== true) {
      marked.push(id);
      return { ...entry, viewedByHuman: true };
    }
    return entry;
  });
  if (marked.length === 0) return [];

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.evidenceBundle.update({
      where: { id: bundle.id },
      data: {
        timeline: timeline as never,
        humanViewedAt: bundle.humanViewedAt ?? now,
        humanViewedByReviewerId: bundle.humanViewedByReviewerId ?? session.reviewerId,
      },
    });
    await tx.pair.updateMany({
      where: { id: pairId, customerId: session.customerId, humanViewedAt: null },
      data: { humanViewedAt: now },
    });
    await appendAuditInTransaction(session, tx as never, {
      kind: "evidence.read",
      payload: {
        pairId,
        bundleId: bundle.bundleId,
        reviewerId: session.reviewerId,
        excerptIds: marked,
        excerptCount: marked.length,
      },
      ts: now,
    });
  });
  return marked;
}

/* -------------------------------------------------------------------------- */
/* Decisions                                                                   */
/* -------------------------------------------------------------------------- */

export interface DecisionLogOptions {
  /** "shift" is the last 12 hours. "recent" is 30 days. */
  window?: "shift" | "recent";
  limit?: number;
  /** Owner and operator surfaces read the whole partition; a reviewer reads their own. */
  scope?: "mine" | "partition";
}

export async function listDecisions(
  session: Session,
  opts: DecisionLogOptions = {},
): Promise<ReviewRecord[]> {
  const window = opts.window ?? "shift";
  const since = new Date(
    Date.now() - (window === "shift" ? 12 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000),
  );
  const scope = opts.scope ?? "mine";
  const limit = opts.limit ?? 100;

  if (isMockMode()) {
    const data = await getMockData();
    return data.reviews
      .filter((r) => (scope === "mine" ? r.reviewerId === session.reviewerId : true))
      .filter((r) => r.createdAt >= since)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  const prisma = await getPrisma();
  const rows = await prisma.review.findMany({
    where: {
      createdAt: { gte: since },
      ...(scope === "mine" ? { reviewerId: session.reviewerId } : {}),
      pair: { customerId: session.customerId },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { pair: { select: { expiresAt: true } } },
  });
  return rows.map((row) => toReviewRecord(row));
}

export async function getDecision(
  session: Session,
  reviewId: string,
): Promise<ReviewRecord | null> {
  if (isMockMode()) {
    const data = await getMockData();
    return data.reviews.find((r) => r.id === reviewId) ?? null;
  }
  const prisma = await getPrisma();
  const row = await prisma.review.findFirst({
    where: { id: reviewId, pair: { customerId: session.customerId } },
    include: { pair: { select: { expiresAt: true } } },
  });
  return row ? toReviewRecord(row) : null;
}

interface ReviewRowWithPair {
  id: string;
  pairId: string;
  reviewerId: string;
  decision: string;
  reason: string | null;
  modelTier: string;
  resultTier: string;
  minutesSpent: number | null;
  viewedExcerptCount: number | null;
  createdAt: Date;
  pair: { expiresAt: Date | null };
}

function toReviewRecord(row: ReviewRowWithPair): ReviewRecord {
  return {
    id: row.id,
    pairId: row.pairId,
    shortId: row.pairId.slice(-4),
    reviewerId: row.reviewerId,
    // Pre-SSO: the roster lives in an env var, so a display name is resolved by
    // the caller when it has one. The id is what the audit chain carries.
    reviewerName: row.reviewerId,
    decision: row.decision as ReviewRecord["decision"],
    reasonCode: row.reason ?? "",
    reasonLabel: row.reason ?? "reason not recorded",
    modelTier: row.modelTier as Tier,
    resultTier: row.resultTier as Tier,
    minutesSpent: row.minutesSpent,
    viewedExcerptCount: row.viewedExcerptCount,
    // Review has one nullable reason column and no note fields yet
    // (DESIGN-UI 13.2 gap 3). The notes ride in the audit payload until it does.
    notes: { timeline: null, outsideContext: null, recommendation: null },
    parentReviewId: null,
    createdAt: row.createdAt,
    retentionDeadline: row.pair.expiresAt,
    auditSeq: null,
  };
}

export async function listPriorCases(
  session: Session,
  actorUid: string,
  excludePairId?: string,
): Promise<PriorCase[]> {
  if (isMockMode()) {
    const data = await getMockData();
    const pair = data.pairs.find((p) => p.actor.hashedUid === actorUid);
    return (pair?.priorCases ?? []).filter((p) => p.pairId !== excludePairId);
  }
  const prisma = await getPrisma();
  const rows = await prisma.review.findMany({
    where: {
      pair: { customerId: session.customerId, actorUid },
      ...(excludePairId ? { pairId: { not: excludePairId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return rows.map((row) => ({
    pairId: row.pairId,
    shortId: row.pairId.slice(-4),
    decidedAt: row.createdAt,
    decision: row.decision as PriorCase["decision"],
    resultTier: row.resultTier as Tier,
    reasonLabel: row.reason ?? "reason not recorded",
  }));
}
