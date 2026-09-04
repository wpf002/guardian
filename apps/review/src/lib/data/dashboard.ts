/**
 * Aggregates for the operator surface.
 *
 * Every figure here counts pairs, actors, decisions or minutes. None of them
 * counts people, and none of them is scoped to one reviewer: no per-reviewer
 * pace value exists in any response this module can produce, which is what
 * makes a leaderboard a new endpoint and a code review rather than a feature
 * flag (DESIGN-UI 1 and 11).
 *
 * Numbers are cut at version boundaries and never smoothed across one. Below a
 * stated n the figure is null so the caller renders "not enough decisions yet"
 * rather than a value.
 */

import { getPrisma, isMockMode } from "../db";
import { getMockData } from "../mock/fixtures";
import type { Session } from "../session";
import type { DashboardSummary, Tier } from "./types";

/** Below this many decisions a rate is not reported. */
export const MIN_DECISIONS_FOR_RATE = 20;

const EMPTY_TIERS: Record<Tier, number> = { T0: 0, T1: 0, T2: 0, T3: 0 };

export interface DashboardOptions {
  windowDays?: number;
  /** Monthly active accounts in minor bands, for the reviewer-minutes metric. */
  activeUsers?: number;
}

export async function getDashboardSummary(
  session: Session,
  opts: DashboardOptions = {},
): Promise<DashboardSummary> {
  const windowDays = opts.windowDays ?? 7;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  if (isMockMode()) {
    const data = await getMockData();
    const pairsByTier = { ...EMPTY_TIERS };
    for (const pair of data.pairs) {
      if (pair.queue.customerId !== session.customerId) continue;
      // The window applies here as it does against a database. Without it the
      // seven and thirty day bars were the same numbers twice.
      if (pair.scoredAt < since) continue;
      pairsByTier[pair.queue.tier] += 1;
    }
    const reviews = data.reviews.filter((r) => r.createdAt >= since);
    const t2Reviews = reviews.filter((r) => r.modelTier === "T2");
    const minutes = reviews.reduce((sum, r) => sum + (r.minutesSpent ?? 0), 0);
    const activeUsers = opts.activeUsers ?? 4200;
    return {
      customerId: session.customerId,
      customerName: data.customer.name,
      windowDays,
      pairsByTier,
      pairsDecided: reviews.length,
      sentToSecondReviewer: reviews.filter((r) => r.decision === "report").length,
      reportsDrafted: reviews.filter((r) => r.resultTier === "T3").length,
      reviewerMinutesPer1kUsers: perThousandPerDay(minutes, activeUsers, windowDays),
      t2PositivePredictiveValue:
        t2Reviews.length >= MIN_DECISIONS_FOR_RATE ? ratioOfConfirmed(t2Reviews) : null,
      decisionsSampleSize: t2Reviews.length,
      oldestProposalAgeHours: 3 * 24,
      activeSeats: data.activeSeats,
      versions: data.pairs[0]?.versions ?? {
        modelVersion: "unknown",
        lexiconVersion: "unknown",
        fusionVersion: "unknown",
      },
    };
  }

  const prisma = await getPrisma();
  const [customer, tierCounts, reviews] = await Promise.all([
    prisma.customer.findUnique({ where: { id: session.customerId }, select: { name: true } }),
    // Grouped on the tier-assignment time, not on updatedAt. updatedAt is
    // @updatedAt, so a reviewer opening or deciding a six month old pair pulled
    // it back into the seven day bar with no tier change behind it.
    prisma.pair.groupBy({
      by: ["tier"],
      where: { customerId: session.customerId, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.review.findMany({
      where: { createdAt: { gte: since }, pair: { customerId: session.customerId } },
      select: { decision: true, resultTier: true, minutesSpent: true, modelTier: true },
    }),
  ]);

  const pairsByTier = { ...EMPTY_TIERS };
  for (const row of tierCounts) {
    pairsByTier[row.tier as Tier] = row._count._all;
  }
  const minutes = reviews.reduce((sum, r) => sum + (r.minutesSpent ?? 0), 0);
  const activeUsers = opts.activeUsers ?? 0;
  const t2Reviews = reviews.filter((r) => r.modelTier === "T2");

  return {
    customerId: session.customerId,
    customerName: customer?.name ?? session.customerId,
    windowDays,
    pairsByTier,
    pairsDecided: reviews.length,
    sentToSecondReviewer: reviews.filter((r) => r.decision === "report").length,
    reportsDrafted: reviews.filter((r) => r.resultTier === "T3").length,
    reviewerMinutesPer1kUsers: perThousandPerDay(minutes, activeUsers, windowDays),
    t2PositivePredictiveValue:
      t2Reviews.length >= MIN_DECISIONS_FOR_RATE
        ? ratioOfConfirmed(t2Reviews.map((r) => ({ decision: r.decision as string })))
        : null,
    decisionsSampleSize: t2Reviews.length,
    oldestProposalAgeHours: null,
    activeSeats: 0,
    versions: { modelVersion: "unknown", lexiconVersion: "unknown", fusionVersion: "unknown" },
  };
}

/**
 * Reviewer minutes per 1,000 users per day, which is what DESIGN.md 10 sets a
 * pass mark against.
 *
 * The minutes are a window total, so the window has to be divided out. Without
 * it the seven day figure was seven times the labelled unit, and a partition
 * comfortably inside the target of two minutes read as a failure at fourteen.
 */
function perThousandPerDay(
  minutes: number,
  activeUsers: number,
  windowDays: number,
): number | null {
  if (activeUsers <= 0 || windowDays <= 0) return null;
  return Math.round((minutes / windowDays / activeUsers) * 1000 * 10) / 10;
}

/**
 * The realized predictive value of one tier, over the decisions on pairs the
 * model put at that tier. Passing every decision in the window diluted the T2
 * figure with T1 and T3 work and made it a number about nothing.
 */
function ratioOfConfirmed(reviews: Array<{ decision: string }>): number {
  if (reviews.length === 0) return 0;
  const held = reviews.filter((r) => r.decision === "confirm" || r.decision === "report").length;
  return Math.round((held / reviews.length) * 1000) / 1000;
}

/**
 * Tier counts over a window, for a small chart. Pairs, never accounts, and
 * never a rate below the reporting threshold.
 */
export async function getTierCounts(
  session: Session,
  windowDays = 7,
): Promise<Record<Tier, number>> {
  const summary = await getDashboardSummary(session, { windowDays });
  return summary.pairsByTier;
}
