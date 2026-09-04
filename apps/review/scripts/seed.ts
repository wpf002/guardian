/**
 * Writes the mock fixtures into a live database, for a demo.
 *
 * Run with: pnpm --filter @guardian/review db:seed
 * Environment: DATABASE_URL, AUDIT_CHAIN_SECRET, and optionally
 * GUARDIAN_SEED_CUSTOMER (defaults to the fixture customer name).
 *
 * The same rows the console renders in mock mode, so a demo against Postgres
 * looks like a demo against nothing. It is destructive for the seeded customer
 * only: it deletes that customer's pairs, reviews and guild rows first, and
 * touches no other customer's data.
 */

import { randomBytes } from "node:crypto";
import { AuditLog, PrismaAuditStore } from "@guardian/audit";
import { createPrismaClient } from "@guardian/schema/db";
import { expiresAt, newCustomerSalt, retentionForTier, sha256Hex } from "@guardian/schema";
import { getMockData, MOCK_CUSTOMER_NAME } from "../src/lib/mock/fixtures";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set. The seed writes to a real database.");
  }
  const secret = process.env.AUDIT_CHAIN_SECRET;
  if (!secret || secret === "change-me") {
    throw new Error("AUDIT_CHAIN_SECRET must be set to a real value.");
  }

  // getMockData reads no environment, so the fixtures are the same set the app
  // renders with GUARDIAN_MOCK=1.
  const data = await getMockData();
  const name = process.env.GUARDIAN_SEED_CUSTOMER ?? MOCK_CUSTOMER_NAME;
  const prisma = createPrismaClient();

  try {
    const existing = await prisma.customer.findFirst({ where: { name } });
    const customer =
      existing ??
      (await prisma.customer.create({
        data: {
          name,
          apiKeyHash: sha256Hex(`seed:${name}:${randomBytes(8).toString("hex")}`),
          idSalt: newCustomerSalt(),
          webhookSecret: randomBytes(24).toString("hex"),
          jurisdictionCountry: data.customer.jurisdictionCountry,
          jurisdictionSubdivision: data.customer.jurisdictionSubdivision,
          lexiconExtension: (data.customer.lexiconExtension ?? undefined) as never,
        },
      }));

    // Reviews reference pairs with Restrict, so they go first.
    await prisma.review.deleteMany({ where: { pair: { customerId: customer.id } } });
    await prisma.evidenceBundle.deleteMany({ where: { customerId: customer.id } });
    await prisma.pair.deleteMany({ where: { customerId: customer.id } });
    await prisma.actor.deleteMany({ where: { customerId: customer.id } });
    await prisma.guildConfig.deleteMany({ where: { customerId: customer.id } });

    for (const pair of data.pairs) {
      const rows = pair.timeline.state === "ready" ? pair.timeline.rows : [];
      const actorUid = pair.actor.hashedUid;
      const targetUid = sha256Hex(`${pair.queue.pairId}:target`);

      await prisma.actor.create({
        data: {
          customerId: customer.id,
          hashedUid: actorUid,
          ageBand: pair.queue.actorBand.band,
          ageBandConfidence: pair.queue.actorBand.confidence,
          ageBandProvenance: pair.queue.actorBand.provenance,
          accountAgeHours: pair.actor.accountAgeHours,
          fanOut7d: pair.actor.fanOut7d,
          minorFanOut7d: pair.actor.minorFanOut7d,
          retention: "WATCH_30D",
          expiresAt: expiresAt("WATCH_30D"),
        },
      });
      await prisma.actor.create({
        data: {
          customerId: customer.id,
          hashedUid: targetUid,
          ageBand: pair.queue.targetBand.band,
          ageBandConfidence: pair.queue.targetBand.confidence,
          ageBandProvenance: pair.queue.targetBand.provenance,
          retention: "WATCH_30D",
          expiresAt: expiresAt("WATCH_30D"),
        },
      });

      const retention = retentionForTier(pair.queue.tier);
      const firstStageAt: Record<string, string> = {};
      for (const point of pair.stagePath) {
        if (point.reachedAt) firstStageAt[point.stage] = point.reachedAt.toISOString();
      }

      await prisma.pair.create({
        data: {
          id: pair.queue.pairId,
          customerId: customer.id,
          actorUid,
          targetUid,
          firstStageAt,
          signals: rows
            .filter((row) => row.signals.length > 0)
            .map((row) => ({
              kind: row.signals[0],
              stage: row.stage ?? "none",
              weight: 0.2,
              excerpt: row.collapsed ? null : row.text,
              viewedByHuman: row.viewedByHuman,
              ts: row.at.toISOString(),
            })),
          tier: pair.queue.tier,
          criticalSignals: pair.queue.criticalSignals,
          soleAutomatedBasis: pair.queue.soleAutomatedBasis,
          suggestedPosture: pair.queue.suggestedPosture ?? undefined,
          messageCounts: { total: pair.queue.messageCount },
          windowStart: rows[0]?.at ?? null,
          windowEnd: rows[rows.length - 1]?.at ?? null,
          modelVersion: pair.versions.modelVersion,
          lexiconVersion: pair.versions.lexiconVersion,
          fusionVersion: pair.versions.fusionVersion,
          humanViewedAt: pair.humanViewedAt,
          retention,
          expiresAt: expiresAt(retention),
          resolvedAt: pair.queue.resolvedAt,
        },
      });
    }

    for (const review of data.reviews) {
      await prisma.review.create({
        data: {
          pairId: review.pairId,
          reviewerId: review.reviewerId,
          decision: review.decision,
          reason: review.reasonCode,
          modelTier: review.modelTier,
          resultTier: review.resultTier,
          minutesSpent: review.minutesSpent,
          feedbackSource: "reviewer",
          viewedExcerptCount: review.viewedExcerptCount,
          createdAt: review.createdAt,
        },
      });
    }

    for (const guild of data.guilds) {
      await prisma.guildConfig.create({
        data: {
          guildId: guild.guildId,
          customerId: customer.id,
          modChannelId: guild.modChannelId,
          roleBands: guild.roleBands,
          trustedRoleIds: guild.trustedRoleIds,
          defaultBand: guild.defaultBand,
          defaultBandProvenance: guild.defaultBandProvenance,
          autoTimeoutOnT2: guild.autoTimeoutOnT2,
          autoTimeoutMinutes: guild.autoTimeoutMinutes,
          excludedChannelIds: guild.excludedChannelIds,
          enabled: guild.enabled,
        },
      });
    }

    // The chain is append-only, so seeding adds entries rather than replacing
    // any. Nothing here rewrites history.
    const log = new AuditLog(new PrismaAuditStore(prisma as never), secret);
    for (const pair of data.pairs) {
      await log.append({
        kind: "score.assigned",
        customerId: customer.id,
        payload: {
          pairId: pair.queue.pairId,
          tier: pair.queue.tier,
          criticalSignals: pair.queue.criticalSignals,
          modelVersion: pair.versions.modelVersion,
          lexiconVersion: pair.versions.lexiconVersion,
          fusionVersion: pair.versions.fusionVersion,
          soleAutomatedBasis: pair.queue.soleAutomatedBasis,
        },
      });
    }

    const head = await log.head();
    console.log(
      `Seeded ${data.pairs.length} pairs, ${data.reviews.length} reviews and ${data.guilds.length} guild rows for customer ${customer.id} (${name}). Audit head is seq ${head.seq}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
