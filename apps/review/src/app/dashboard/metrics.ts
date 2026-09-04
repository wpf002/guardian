/**
 * The operator dashboard's aggregation, composed from the exported data layer.
 *
 * RESEARCH 6.9 is the spec: three questions and stop. Every figure counts
 * pairs, decisions, signals, chain entries or minutes. Nothing counts people,
 * nothing is scoped to one reviewer, and there is no ordering of reviewers
 * anywhere in this module, which is what makes a leaderboard a new file and a
 * code review rather than a prop.
 *
 * This lives beside the page rather than in lib/data because the page owner
 * wrote it. The retention rollup in particular belongs in lib/data once the
 * data-layer owner wants it; see the note above retentionStatus().
 */

import { getPrisma, isMockMode } from "@/lib/db";
import { getMockData } from "@/lib/mock/fixtures";
import { getDashboardSummary, MIN_DECISIONS_FOR_RATE } from "@/lib/data/dashboard";
import { getCase, listDecisions, listQueue, BREACH_RISK_MINUTES } from "@/lib/data/cases";
import { getAuditHead, listAuditEntries, verifyAuditChain } from "@/lib/data/audit";
import type { Session } from "@/lib/auth";
import type { ReviewDecision, Tier, Versions } from "@/lib/data/types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** DESIGN.md 6.4: a human sees a T2 within four hours. A queue target, never a stopwatch. */
export const T2_SLA_MINUTES = 4 * 60;

/** DESIGN.md 10: two or fewer reviewer minutes per 1,000 users per day is a pass. */
export const REVIEWER_MINUTES_TARGET = 2;

/** DESIGN.md 6.4, stated as targets and never printed as though they were results. */
export const TARGET_PPV: Record<Tier, string | null> = {
  T0: null,
  T1: "10% or better",
  T2: "40% or better",
  T3: "90% or better",
};

/** Monthly active accounts, until a customer record carries the number. */
const ASSUMED_ACTIVE_USERS = 4200;

/** The deletion job's cycle. Used only to say when the next sweep is expected. */
const SWEEP_INTERVAL_HOURS = 24;

/** How many recent decisions the latency sample walks. A dashboard is weekly, not live. */
const LATENCY_SAMPLE = 30;

export type RetentionClass = "EPHEMERAL_24H" | "WATCH_30D" | "CASE_1Y" | "LEGAL_HOLD";

export const RETENTION_LABEL: Record<RetentionClass, string> = {
  EPHEMERAL_24H: "Ephemeral, 24 hours",
  WATCH_30D: "Watch, 30 days",
  CASE_1Y: "Case, 1 year",
  LEGAL_HOLD: "Legal hold, no clock",
};

const CRITICAL_SIGNAL_LABEL: Record<string, string> = {
  threat_template: "Threat template match",
  payment_after_media: "Payment demand after a media event",
  meetup_logistics: "Meetup logistics with an age gap",
  known_csam_hash: "Known-hash verdict from the operator",
  coercion_nonfinancial: "Non-financial coercion language",
};

export function criticalSignalLabel(kind: string): string {
  return CRITICAL_SIGNAL_LABEL[kind] ?? kind.replace(/_/g, " ");
}

const DECISION_LABEL: Record<ReviewDecision, string> = {
  dismiss: "No action, insufficient signal",
  watch: "Watch, retained 30 days",
  confirm: "Reviewer-confirmed at T2",
  report: "Sent to a second reviewer",
};

export function decisionLabel(decision: ReviewDecision): string {
  return DECISION_LABEL[decision] ?? decision;
}

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

export interface QueueHealth {
  openT1: number;
  openT2: number;
  /** Minutes since the oldest open T2 entered the queue. Null when none is open. */
  oldestT2AgeMinutes: number | null;
  /** Negative once the four hour target has passed. Null when no T2 is open. */
  oldestT2SlaRemainingMinutes: number | null;
  breachRiskCount: number;
  unclaimedCount: number;
  /** Median minutes from the score being assigned to the decision being recorded. */
  medianMinutesToDecision: number | null;
  latencySampleSize: number;
  lastArrivalAt: Date | null;
  partitionName: string;
}

export interface CostAndCalibration {
  reviewerMinutesPer1kUsers: number | null;
  assumedActiveUsers: number;
  minutesLogged: number;
  decisionsCounted: number;
  /**
   * Realized T2 predictive value: confirms and proposals as a share of the
   * decisions on pairs the model put at T2, and nothing else. Null below n.
   */
  realizedT2Ppv: number | null;
  /** The denominator of that ratio: decisions on model-T2 pairs in the window. */
  ppvSampleSize: number;
  minSampleForRate: number;
}

export interface TierRateRow {
  tier: Tier;
  windowDays: number;
  count: number;
  sharePercent: number | null;
}

export interface DecisionMixRow {
  decision: ReviewDecision;
  label: string;
  count: number;
  sharePercent: number | null;
}

export interface CriticalSignalRow {
  kind: string;
  label: string;
  count: number;
}

export interface RetentionRow {
  retentionClass: RetentionClass;
  label: string;
  pairs: number;
}

export interface RetentionStatus {
  rows: RetentionRow[];
  /** Derived from tier in mock mode, read from the column against a database. */
  derivedFromTier: boolean;
  earliestExpiryAt: Date | null;
  lastSweepAt: Date | null;
  lastSweepSeq: number | null;
  /** Null when the chain entry did not record a count. Never read null as zero. */
  lastSweepDeleted: number | null;
  nextSweepExpectedAt: Date | null;
}

export interface AuditStatus {
  headSeq: number;
  headHash: string;
  entriesInWindow: number;
  verification: VerificationView;
}

/**
 * The broken variant carries the sequence number and the reason and nothing
 * else. The verifier's own detail string names the entry's kind and the
 * customer that wrote it, and the chain spans every customer, so surfacing it
 * on one operator's dashboard would print another tenant's identifiers. It goes
 * to the server log instead.
 */
export type VerificationView =
  | { state: "ok"; checked: number; head: string; at: Date }
  | { state: "broken"; checked: number; brokenAt: number; reason: string; at: Date }
  | { state: "unavailable"; why: string; at: Date };

export interface VersionSighting {
  versions: Versions;
  scoresSeen: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface DashboardMetrics {
  customerName: string;
  generatedAt: Date;
  shortWindowDays: number;
  longWindowDays: number;
  queue: QueueHealth;
  cost: CostAndCalibration;
  tierRates: TierRateRow[];
  decisionMix: DecisionMixRow[];
  decisionsInWindow: number;
  criticalSignals: CriticalSignalRow[];
  criticalSignalTotal: number;
  retention: RetentionStatus;
  audit: AuditStatus;
  /** The triple the scorer stamped on the most recent score in this partition. */
  currentVersions: Versions;
  versionHistory: VersionSighting[];
  activeSeats: number;
  /** True when there is nothing at all to show, so the page renders its empty state. */
  isEmpty: boolean;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
  return Math.round(value);
}

function share(count: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((count / total) * 1000) / 10;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function versionKey(versions: Versions): string {
  return `${versions.modelVersion}|${versions.lexiconVersion}|${versions.fusionVersion}`;
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Pairs by retention class, plus what the deletion job last did.
 *
 * Against a database this groups on the column. In mock mode there is no
 * retention column on the fixture view model, so the class is derived from the
 * tier using the policy in DESIGN.md 7 (T0 raw text within 24h, T1 30 days, T3
 * one year) and the card says so rather than presenting a derivation as a read.
 * Promote this into lib/data when the data-layer owner wants it; the database
 * branch is already the shape a groupBy returns.
 */
async function retentionStatus(session: Session, now: Date): Promise<RetentionStatus> {
  const counts: Record<RetentionClass, number> = {
    EPHEMERAL_24H: 0,
    WATCH_30D: 0,
    CASE_1Y: 0,
    LEGAL_HOLD: 0,
  };
  let derivedFromTier = false;
  let earliestExpiryAt: Date | null = null;

  if (isMockMode()) {
    derivedFromTier = true;
    const data = await getMockData();
    for (const pair of data.pairs) {
      if (pair.queue.customerId !== session.customerId) continue;
      const tier = pair.queue.tier;
      const cls: RetentionClass =
        tier === "T3" ? "CASE_1Y" : tier === "T0" ? "EPHEMERAL_24H" : "WATCH_30D";
      counts[cls] += 1;
    }
    for (const review of data.reviews) {
      const deadline = review.retentionDeadline;
      if (!deadline || deadline.getTime() <= now.getTime()) continue;
      if (!earliestExpiryAt || deadline < earliestExpiryAt) earliestExpiryAt = deadline;
    }
  } else {
    const prisma = await getPrisma();
    const grouped = await prisma.pair.groupBy({
      by: ["retention"],
      where: { customerId: session.customerId },
      _count: { _all: true },
      _min: { expiresAt: true },
    });
    for (const row of grouped) {
      const cls = row.retention as RetentionClass;
      if (cls in counts) counts[cls] = row._count._all;
      const min = row._min.expiresAt;
      if (min && (!earliestExpiryAt || min < earliestExpiryAt)) earliestExpiryAt = min;
    }
  }

  const sweeps = await listAuditEntries(session, { kind: "retention.deleted", limit: 1 });
  const lastSweep = sweeps[0] ?? null;
  const deleted = lastSweep?.payload?.deleted;

  return {
    rows: (Object.keys(counts) as RetentionClass[]).map((cls) => ({
      retentionClass: cls,
      label: RETENTION_LABEL[cls],
      pairs: counts[cls],
    })),
    derivedFromTier,
    earliestExpiryAt,
    lastSweepAt: lastSweep ? lastSweep.ts : null,
    lastSweepSeq: lastSweep ? lastSweep.seq : null,
    lastSweepDeleted: typeof deleted === "number" ? deleted : null,
    nextSweepExpectedAt: lastSweep
      ? new Date(lastSweep.ts.getTime() + SWEEP_INTERVAL_HOURS * HOUR_MS)
      : null,
  };
}

/** How far back from the head a dashboard verification walks. */
export const VERIFY_TAIL_ENTRIES = 500;

/**
 * Walks the tail of the chain and names the row that broke, rather than
 * returning a bare false.
 *
 * The tail rather than the whole chain: seq is assigned across every customer,
 * so verifying from entry 1 loads every other customer's rows into this process
 * on every render of this page. The window is stated on the panel.
 */
export async function runVerification(now = new Date()): Promise<VerificationView> {
  try {
    const head = await getAuditHead();
    const from = Math.max(1, head.seq - VERIFY_TAIL_ENTRIES + 1);
    const result = await verifyAuditChain(from, VERIFY_TAIL_ENTRIES);
    if (result.ok) {
      return { state: "ok", checked: result.checked, head: result.head, at: now };
    }
    console.error(
      `[guardian] audit chain verification failed at #${result.brokenAt}: ${result.detail}`,
    );
    return {
      state: "broken",
      checked: result.checked,
      brokenAt: result.brokenAt,
      reason: result.reason,
      at: now,
    };
  } catch (error) {
    return {
      state: "unavailable",
      why: error instanceof Error ? error.message : "the chain could not be read",
      at: now,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* The read                                                                    */
/* -------------------------------------------------------------------------- */

export interface MetricsOptions {
  shortWindowDays?: number;
  longWindowDays?: number;
  activeUsers?: number;
  now?: Date;
}

export async function getDashboardMetrics(
  session: Session,
  opts: MetricsOptions = {},
): Promise<DashboardMetrics> {
  const now = opts.now ?? new Date();
  const shortWindowDays = opts.shortWindowDays ?? 7;
  const longWindowDays = opts.longWindowDays ?? 30;
  const activeUsers = opts.activeUsers ?? ASSUMED_ACTIVE_USERS;
  const shortSince = new Date(now.getTime() - shortWindowDays * DAY_MS);

  const [queuePage, shortSummary, longSummary, decisions, head, scoreEntries] = await Promise.all([
    listQueue(session, { limit: 200 }),
    getDashboardSummary(session, { windowDays: shortWindowDays, activeUsers }),
    getDashboardSummary(session, { windowDays: longWindowDays, activeUsers }),
    listDecisions(session, { window: "recent", scope: "partition", limit: 500 }),
    getAuditHead(),
    listAuditEntries(session, { kind: "score.assigned", limit: 500 }),
  ]);

  /* Queue health. Age is the SLA target minus what is left on it, which is what
     the queue row already carries, so no second clock has to agree with it. */
  const open = queuePage.cases;
  const openT2 = open.filter((row) => row.tier === "T2");
  const oldestT2 = openT2.reduce<(typeof openT2)[number] | null>((oldest, row) => {
    if (row.slaRemainingMinutes === null) return oldest;
    if (!oldest || oldest.slaRemainingMinutes === null) return row;
    return row.slaRemainingMinutes < oldest.slaRemainingMinutes ? row : oldest;
  }, null);
  const oldestRemaining = oldestT2?.slaRemainingMinutes ?? null;

  const sample = decisions.slice(0, LATENCY_SAMPLE);
  const sampled = await Promise.all(
    sample.map((review) => getCase(session, review.pairId).catch(() => null)),
  );
  const latencies: number[] = [];
  sampled.forEach((detail, index) => {
    const review = sample[index];
    if (!detail || !review) return;
    const minutes = (review.createdAt.getTime() - detail.scoredAt.getTime()) / 60_000;
    if (Number.isFinite(minutes) && minutes >= 0) latencies.push(minutes);
  });

  const queue: QueueHealth = {
    openT1: open.filter((row) => row.tier === "T1").length,
    openT2: openT2.length,
    oldestT2AgeMinutes: oldestRemaining === null ? null : T2_SLA_MINUTES - oldestRemaining,
    oldestT2SlaRemainingMinutes: oldestRemaining,
    breachRiskCount: queuePage.summary.breachRiskCount,
    unclaimedCount: queuePage.summary.unclaimedCount,
    medianMinutesToDecision: median(latencies),
    latencySampleSize: latencies.length,
    lastArrivalAt: queuePage.summary.lastArrivalAt,
    partitionName: queuePage.summary.partitionName,
  };

  /* Cost and calibration. The headline is aggregate minutes per 1,000 users. */
  const minutesLogged = decisions.reduce((sum, review) => sum + (review.minutesSpent ?? 0), 0);
  const cost: CostAndCalibration = {
    reviewerMinutesPer1kUsers: shortSummary.reviewerMinutesPer1kUsers,
    assumedActiveUsers: activeUsers,
    minutesLogged,
    decisionsCounted: decisions.length,
    realizedT2Ppv: shortSummary.t2PositivePredictiveValue,
    ppvSampleSize: shortSummary.decisionsSampleSize,
    minSampleForRate: MIN_DECISIONS_FOR_RATE,
  };

  /* Tier rates, both windows, as counts of pairs and a share of the window. */
  const tierRates: TierRateRow[] = [];
  for (const [summary, windowDays] of [
    [shortSummary, shortWindowDays],
    [longSummary, longWindowDays],
  ] as const) {
    const total = (Object.values(summary.pairsByTier) as number[]).reduce((a, b) => a + b, 0);
    for (const tier of ["T1", "T2", "T3"] as Tier[]) {
      tierRates.push({
        tier,
        windowDays,
        count: summary.pairsByTier[tier],
        sharePercent: share(summary.pairsByTier[tier], total),
      });
    }
  }

  /* Decision mix over the long window. */
  const mixCounts: Record<ReviewDecision, number> = { dismiss: 0, watch: 0, confirm: 0, report: 0 };
  for (const review of decisions) mixCounts[review.decision] += 1;
  const decisionMix: DecisionMixRow[] = (Object.keys(mixCounts) as ReviewDecision[]).map(
    (decision) => ({
      decision,
      label: decisionLabel(decision),
      count: mixCounts[decision],
      sharePercent: share(mixCounts[decision], decisions.length),
    }),
  );

  /* Critical signals by kind, from the score entries in the chain, so a pair
     already resolved still counts toward the window it fired in. */
  const signalCounts = new Map<string, number>();
  const versionSightings = new Map<string, VersionSighting>();
  let entriesInWindow = 0;
  for (const entry of scoreEntries) {
    const inWindow = entry.ts >= shortSince;
    if (inWindow) entriesInWindow += 1;
    if (inWindow) {
      for (const kind of asStringArray(entry.payload.criticalSignals)) {
        signalCounts.set(kind, (signalCounts.get(kind) ?? 0) + 1);
      }
    }
    const versions: Versions = {
      modelVersion: String(entry.payload.modelVersion ?? "unknown"),
      lexiconVersion: String(entry.payload.lexiconVersion ?? "unknown"),
      fusionVersion: String(entry.payload.fusionVersion ?? "unknown"),
    };
    const key = versionKey(versions);
    const seen = versionSightings.get(key);
    if (!seen) {
      versionSightings.set(key, {
        versions,
        scoresSeen: 1,
        firstSeenAt: entry.ts,
        lastSeenAt: entry.ts,
      });
    } else {
      seen.scoresSeen += 1;
      if (entry.ts < seen.firstSeenAt) seen.firstSeenAt = entry.ts;
      if (entry.ts > seen.lastSeenAt) seen.lastSeenAt = entry.ts;
    }
  }
  const criticalSignals: CriticalSignalRow[] = [...signalCounts.entries()]
    .map(([kind, count]) => ({ kind, label: criticalSignalLabel(kind), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const criticalSignalTotal = criticalSignals.reduce((sum, row) => sum + row.count, 0);

  const [retention, verification] = await Promise.all([
    retentionStatus(session, now),
    runVerification(now),
  ]);

  const versionHistory = [...versionSightings.values()].sort(
    (a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime(),
  );

  return {
    customerName: shortSummary.customerName,
    generatedAt: now,
    shortWindowDays,
    longWindowDays,
    queue,
    cost,
    tierRates,
    decisionMix,
    decisionsInWindow: decisions.length,
    criticalSignals,
    criticalSignalTotal,
    retention,
    audit: {
      headSeq: head.seq,
      headHash: head.hash,
      entriesInWindow,
      verification,
    },
    currentVersions: versionHistory[0]?.versions ?? shortSummary.versions,
    versionHistory,
    activeSeats: shortSummary.activeSeats,
    isEmpty:
      open.length === 0 &&
      decisions.length === 0 &&
      scoreEntries.length === 0 &&
      head.seq === 0,
  };
}

export { BREACH_RISK_MINUTES };
