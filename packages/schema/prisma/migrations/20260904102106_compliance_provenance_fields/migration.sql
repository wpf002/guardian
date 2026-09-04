-- CreateEnum
CREATE TYPE "AgeBandProvenance" AS ENUM ('facial_estimate', 'government_id', 'os_bracket', 'server_role', 'platform_default', 'customer_declared', 'unknown');

-- CreateEnum
CREATE TYPE "LegalBasis" AS ENUM ('provider_2258a', 'processor', 'parental_consent', 'operator_authority');

-- CreateEnum
CREATE TYPE "ChannelVisibility" AS ENUM ('public', 'private', 'group');

-- CreateEnum
CREATE TYPE "FeedbackSource" AS ENUM ('reviewer', 'moderator', 'automated', 'unknown');

-- AlterTable
ALTER TABLE "actors" ADD COLUMN     "ageBandConfidence" DOUBLE PRECISION,
ADD COLUMN     "ageBandProvenance" "AgeBandProvenance" NOT NULL DEFAULT 'unknown';

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "jurisdictionCountry" TEXT,
ADD COLUMN     "jurisdictionSubdivision" TEXT,
ADD COLUMN     "legalBasis" "LegalBasis";

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "actorBandConfidence" DOUBLE PRECISION,
ADD COLUMN     "actorBandProvenance" "AgeBandProvenance" NOT NULL DEFAULT 'unknown',
ADD COLUMN     "channelVisibility" "ChannelVisibility",
ADD COLUMN     "targetBandConfidence" DOUBLE PRECISION,
ADD COLUMN     "targetBandProvenance" "AgeBandProvenance" NOT NULL DEFAULT 'unknown';

-- AlterTable
ALTER TABLE "evidence_bundles" ADD COLUMN     "humanViewedAt" TIMESTAMP(3),
ADD COLUMN     "humanViewedByReviewerId" TEXT,
ADD COLUMN     "jurisdictionCountry" TEXT,
ADD COLUMN     "jurisdictionSubdivision" TEXT,
ADD COLUMN     "legalBasis" "LegalBasis";

-- AlterTable
ALTER TABLE "guild_configs" ADD COLUMN     "defaultBandProvenance" "AgeBandProvenance" NOT NULL DEFAULT 'platform_default';

-- AlterTable
ALTER TABLE "pairs" ADD COLUMN     "humanViewedAt" TIMESTAMP(3),
ADD COLUMN     "soleAutomatedBasis" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "feedbackSource" "FeedbackSource" NOT NULL DEFAULT 'unknown',
ADD COLUMN     "viewedExcerptCount" INTEGER;
