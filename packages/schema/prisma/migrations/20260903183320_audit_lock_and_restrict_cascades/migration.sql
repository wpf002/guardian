/*
  Warnings:

  - A unique constraint covering the columns `[prevHash]` on the table `audit_entries` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[hash]` on the table `audit_entries` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "audit_entries" DROP CONSTRAINT "audit_entries_customerId_fkey";

-- DropForeignKey
ALTER TABLE "cybertipline_reports" DROP CONSTRAINT "cybertipline_reports_bundleId_fkey";

-- DropForeignKey
ALTER TABLE "evidence_bundles" DROP CONSTRAINT "evidence_bundles_customerId_fkey";

-- DropForeignKey
ALTER TABLE "pairs" DROP CONSTRAINT "pairs_customerId_actorUid_fkey";

-- DropForeignKey
ALTER TABLE "pairs" DROP CONSTRAINT "pairs_customerId_fkey";

-- DropForeignKey
ALTER TABLE "pairs" DROP CONSTRAINT "pairs_customerId_targetUid_fkey";

-- DropForeignKey
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_pairId_fkey";

-- AlterTable
ALTER TABLE "audit_entries" ALTER COLUMN "seq" DROP DEFAULT;
DROP SEQUENCE "audit_entries_seq_seq";

-- CreateIndex
CREATE UNIQUE INDEX "audit_entries_prevHash_key" ON "audit_entries"("prevHash");

-- CreateIndex
CREATE UNIQUE INDEX "audit_entries_hash_key" ON "audit_entries"("hash");

-- AddForeignKey
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "pairs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_bundles" ADD CONSTRAINT "evidence_bundles_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cybertipline_reports" ADD CONSTRAINT "cybertipline_reports_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "evidence_bundles"("bundleId") ON DELETE RESTRICT ON UPDATE CASCADE;
