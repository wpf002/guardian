-- CreateEnum
CREATE TYPE "VelocityWindow" AS ENUM ('fast', 'slow', 'standard');

-- CreateEnum
CREATE TYPE "LexiconCandidateStatus" AS ENUM ('proposed', 'accepted', 'rejected');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "endToEndEncrypted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ncmecCredentialCiphertext" TEXT,
ADD COLUMN     "ncmecCredentialKeyId" TEXT,
ADD COLUMN     "ncmecEspId" TEXT,
ADD COLUMN     "ncmecProviderName" TEXT,
ADD COLUMN     "timezone" TEXT;

-- AlterTable
ALTER TABLE "pairs" ADD COLUMN     "fanInSummary" JSONB,
ADD COLUMN     "velocityWindow" "VelocityWindow";

-- AlterTable
ALTER TABLE "webhook_deliveries" ADD COLUMN     "externalId" TEXT;

-- CreateTable
CREATE TABLE "lexicon_candidates" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "proposedList" TEXT NOT NULL,
    "lexiconVersion" TEXT NOT NULL,
    "source" "FeedbackSource" NOT NULL DEFAULT 'unknown',
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "LexiconCandidateStatus" NOT NULL DEFAULT 'proposed',
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "promotedToVersion" TEXT,
    "retention" "RetentionClass" NOT NULL DEFAULT 'WATCH_30D',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lexicon_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lexicon_candidates_customerId_status_lastSeenAt_idx" ON "lexicon_candidates"("customerId", "status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "lexicon_candidates_expiresAt_idx" ON "lexicon_candidates"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "lexicon_candidates_customerId_proposedList_normalized_key" ON "lexicon_candidates"("customerId", "proposedList", "normalized");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_customerId_kind_externalId_key" ON "webhook_deliveries"("customerId", "kind", "externalId");

-- AddForeignKey
ALTER TABLE "lexicon_candidates" ADD CONSTRAINT "lexicon_candidates_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

