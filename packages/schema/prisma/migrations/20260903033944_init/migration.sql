-- CreateEnum
CREATE TYPE "AgeBand" AS ENUM ('UNDER_9', 'A9_12', 'A13_15', 'A16_17', 'A18_20', 'A21_PLUS', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('T0', 'T1', 'T2', 'T3');

-- CreateEnum
CREATE TYPE "RetentionClass" AS ENUM ('EPHEMERAL_24H', 'WATCH_30D', 'CASE_1Y', 'LEGAL_HOLD');

-- CreateEnum
CREATE TYPE "Stage" AS ENUM ('none', 'contact', 'trust', 'probe', 'migrate', 'sexualize', 'coerce');

-- CreateEnum
CREATE TYPE "ActorRole" AS ENUM ('member', 'moderator', 'trusted_adult', 'unknown');

-- CreateEnum
CREATE TYPE "Surface" AS ENUM ('discord', 'platform_sdk', 'parent_app', 'investigator');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('dismiss', 'watch', 'confirm', 'report');

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "idSalt" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "crossCustomerOptIn" BOOLEAN NOT NULL DEFAULT false,
    "lexiconExtension" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "actors" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "hashedUid" TEXT NOT NULL,
    "ageBand" "AgeBand" NOT NULL DEFAULT 'UNKNOWN',
    "role" "ActorRole" NOT NULL DEFAULT 'unknown',
    "accountAgeHours" DOUBLE PRECISION,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "skewScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fanOut7d" INTEGER NOT NULL DEFAULT 0,
    "minorFanOut7d" INTEGER NOT NULL DEFAULT 0,
    "graphState" JSONB,
    "hints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "actionedAt" TIMESTAMP(3),
    "retention" "RetentionClass" NOT NULL DEFAULT 'WATCH_30D',
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "actors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "actorUid" TEXT NOT NULL,
    "targetUid" TEXT,
    "channel" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "text" TEXT,
    "mediaSha256" TEXT,
    "knownCsamVerdict" TEXT,
    "actorBand" "AgeBand" NOT NULL DEFAULT 'UNKNOWN',
    "targetBand" "AgeBand" NOT NULL DEFAULT 'UNKNOWN',
    "actorRole" "ActorRole" NOT NULL DEFAULT 'unknown',
    "features" JSONB,
    "stageProbs" JSONB,
    "stage" "Stage",
    "surface" "Surface" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "modelVersion" TEXT,
    "lexiconVersion" TEXT,
    "fusionVersion" TEXT,
    "retention" "RetentionClass" NOT NULL DEFAULT 'EPHEMERAL_24H',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pairs" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "actorUid" TEXT NOT NULL,
    "targetUid" TEXT NOT NULL,
    "firstStageAt" JSONB NOT NULL,
    "signals" JSONB NOT NULL,
    "pairScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actorScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fusedScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tier" "Tier" NOT NULL DEFAULT 'T0',
    "criticalSignals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "messageCounts" JSONB,
    "lastInboundMediaAt" TIMESTAMP(3),
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "modelVersion" TEXT,
    "lexiconVersion" TEXT,
    "fusionVersion" TEXT,
    "retention" "RetentionClass" NOT NULL DEFAULT 'EPHEMERAL_24H',
    "expiresAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "reason" TEXT,
    "modelTier" "Tier" NOT NULL,
    "resultTier" "Tier" NOT NULL,
    "minutesSpent" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_bundles" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "pairId" TEXT,
    "actorUid" TEXT NOT NULL,
    "targetUid" TEXT NOT NULL,
    "tier" "Tier" NOT NULL,
    "timeline" JSONB NOT NULL,
    "signals" JSONB NOT NULL,
    "provenance" JSONB NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "lexiconVersion" TEXT NOT NULL,
    "fusionVersion" TEXT NOT NULL,
    "auditHead" TEXT NOT NULL,
    "retention" "RetentionClass" NOT NULL DEFAULT 'WATCH_30D',
    "expiresAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cybertipline_reports" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "reporterCustomerId" TEXT NOT NULL,
    "ncmecReportId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "submittedAt" TIMESTAMP(3),
    "preserveUntil" TIMESTAMP(3),
    "retention" "RetentionClass" NOT NULL DEFAULT 'CASE_1Y',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cybertipline_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_entries" (
    "seq" SERIAL NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "audit_entries_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "customer_violations" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_violations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guild_configs" (
    "guildId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "modChannelId" TEXT,
    "roleBands" JSONB NOT NULL DEFAULT '{}',
    "trustedRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultBand" "AgeBand" NOT NULL DEFAULT 'A13_15',
    "autoTimeoutOnT2" BOOLEAN NOT NULL DEFAULT false,
    "autoTimeoutMinutes" INTEGER NOT NULL DEFAULT 60,
    "excludedChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guild_configs_pkey" PRIMARY KEY ("guildId")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_apiKeyHash_key" ON "customers"("apiKeyHash");

-- CreateIndex
CREATE INDEX "actors_customerId_expiresAt_idx" ON "actors"("customerId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "actors_customerId_hashedUid_key" ON "actors"("customerId", "hashedUid");

-- CreateIndex
CREATE INDEX "events_customerId_actorUid_ts_idx" ON "events"("customerId", "actorUid", "ts");

-- CreateIndex
CREATE INDEX "events_customerId_targetUid_ts_idx" ON "events"("customerId", "targetUid", "ts");

-- CreateIndex
CREATE INDEX "events_expiresAt_idx" ON "events"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "events_customerId_externalId_key" ON "events"("customerId", "externalId");

-- CreateIndex
CREATE INDEX "pairs_customerId_tier_updatedAt_idx" ON "pairs"("customerId", "tier", "updatedAt");

-- CreateIndex
CREATE INDEX "pairs_expiresAt_idx" ON "pairs"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "pairs_customerId_actorUid_targetUid_key" ON "pairs"("customerId", "actorUid", "targetUid");

-- CreateIndex
CREATE INDEX "reviews_pairId_createdAt_idx" ON "reviews"("pairId", "createdAt");

-- CreateIndex
CREATE INDEX "reviews_reviewerId_createdAt_idx" ON "reviews"("reviewerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_bundles_bundleId_key" ON "evidence_bundles"("bundleId");

-- CreateIndex
CREATE INDEX "evidence_bundles_customerId_tier_generatedAt_idx" ON "evidence_bundles"("customerId", "tier", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "cybertipline_reports_bundleId_key" ON "cybertipline_reports"("bundleId");

-- CreateIndex
CREATE INDEX "cybertipline_reports_customerId_status_idx" ON "cybertipline_reports"("customerId", "status");

-- CreateIndex
CREATE INDEX "audit_entries_customerId_seq_idx" ON "audit_entries"("customerId", "seq");

-- CreateIndex
CREATE INDEX "audit_entries_kind_ts_idx" ON "audit_entries"("kind", "ts");

-- CreateIndex
CREATE INDEX "customer_violations_customerId_createdAt_idx" ON "customer_violations"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "guild_configs_customerId_idx" ON "guild_configs"("customerId");

-- AddForeignKey
ALTER TABLE "actors" ADD CONSTRAINT "actors_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_customerId_actorUid_fkey" FOREIGN KEY ("customerId", "actorUid") REFERENCES "actors"("customerId", "hashedUid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_customerId_targetUid_fkey" FOREIGN KEY ("customerId", "targetUid") REFERENCES "actors"("customerId", "hashedUid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "pairs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_bundles" ADD CONSTRAINT "evidence_bundles_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_bundles" ADD CONSTRAINT "evidence_bundles_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "pairs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cybertipline_reports" ADD CONSTRAINT "cybertipline_reports_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "evidence_bundles"("bundleId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_violations" ADD CONSTRAINT "customer_violations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
