-- CreateEnum
CREATE TYPE "SuggestedPosture" AS ENUM ('enforcement', 'support');

-- AlterTable
ALTER TABLE "pairs" ADD COLUMN     "suggestedPosture" "SuggestedPosture";
