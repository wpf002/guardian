-- ROADMAP 2b.3. How a surface knows two accounts were talking to each other.
-- A reply is a statement by the sender; adjacency is Guardian inferring it
-- because they were the only two people in the channel. A reviewer about to
-- file a federal report needs to know which one the case rests on.
CREATE TYPE "TargetSource" AS ENUM ('reply', 'mention', 'adjacency');

-- Nullable with no backfill: a pair written before this column recorded no
-- answer, and a guess in the field that says how sure Guardian is would be
-- worse than an absence a reviewer can see.
ALTER TABLE "pairs" ADD COLUMN "targetSource" "TargetSource";
