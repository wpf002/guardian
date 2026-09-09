/**
 * What the console will show, without signing in.
 *
 * Calls the same data functions /queue and /cases/[id] call, with a session for
 * the seat named in REVIEWERS, so the answer is what those pages render rather
 * than what the tables happen to contain. Written while connecting the Discord
 * bot to the console for the first time: the bot had never written a pair or an
 * evidence bundle, so the console had only ever displayed fixtures, and a query
 * against the tables would not have proved the pages could read them.
 *
 *   GUARDIAN_MOCK=0 pnpm --filter @guardian/review exec tsx scripts/check-live.ts
 */
import { listQueue, getCase, getTimeline } from "@/lib/data/cases";
import type { Session } from "@/lib/session";

const seat = JSON.parse(process.env.REVIEWERS ?? "[]")[0] as
  | { id: string; name: string; role: "reviewer" | "operator" | "owner"; customerId: string }
  | undefined;
if (!seat) throw new Error("REVIEWERS is not set, so there is no seat to read as");

const session: Session = {
  reviewerId: seat.id,
  displayName: seat.name,
  role: seat.role,
  customerId: seat.customerId,
  issuedAt: Date.now(),
};

async function main() {
  const page = await listQueue(session);
  console.log(`queue: ${page.summary.total} waiting for ${page.summary.partitionName}`);
  for (const row of page.cases) {
    console.log(`  ${row.tier}  ${row.shortId}  ${row.patternClause}`);
    console.log(`      bands ${row.actorBand.band}/${row.actorBand.provenance} -> ${row.targetBand.band}/${row.targetBand.provenance}`);
  }
  const first = page.cases[0];
  if (!first) return;
  const detail = await getCase(session, first.pairId);
  console.log(`\ncase ${first.shortId}: ${detail?.whySentence}`);
  const timeline = await getTimeline(session, first.pairId);
  console.log(`timeline: ${timeline.state}`);
  if (timeline.state === "ready") {
    for (const r of timeline.rows) {
      console.log(`  ${r.speaker ?? "?"} ${r.stage ?? "-"}  ${JSON.stringify(r.text)?.slice(0, 70)}`);
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
