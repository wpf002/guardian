-- CreateEnum
CREATE TYPE "ReviewState" AS ENUM ('recorded', 'proposed', 'upheld', 'overturned', 'withdrawn');

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "state" "ReviewState" NOT NULL DEFAULT 'recorded';
ALTER TABLE "reviews" ADD COLUMN     "parentReviewId" TEXT;

-- Existing rows: a report decision wrote no tier, so it was a proposal. Every
-- other decision was recorded. Nothing in the table has ever been a concurrence,
-- because no code path could produce one.
UPDATE "reviews" SET "state" = 'proposed' WHERE "decision" = 'report';

-- CreateIndex
CREATE INDEX "reviews_pairId_state_idx" ON "reviews"("pairId", "state");
CREATE INDEX "reviews_parentReviewId_idx" ON "reviews"("parentReviewId");

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_parentReviewId_fkey" FOREIGN KEY ("parentReviewId") REFERENCES "reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
