-- ROADMAP S-9. reviews.modelTier was documented as the tier the model assigned
-- and was set from pairs.tier at decision time, which is a reviewer's tier
-- after any earlier decision. One column meant two things, and the second
-- meaning let the hash chain assert the model had reached T3.

-- The existing values are exactly "the tier the pair carried at the decision",
-- so the rename preserves them and loses nothing.
ALTER TABLE "reviews" RENAME COLUMN "modelTier" TO "priorTier";

-- The model's own tier, which nothing recorded separately. Nullable with no
-- backfill: for a row written before this, the model's tier is not knowable
-- from what was stored, and a guess in a calibration denominator is worse than
-- an absence the metric can exclude.
ALTER TABLE "pairs" ADD COLUMN "modelTier" "Tier";
ALTER TABLE "reviews" ADD COLUMN "modelTier" "Tier";
