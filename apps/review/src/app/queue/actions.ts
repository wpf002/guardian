"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getCase } from "@/lib/data/cases";
import type { OpenMode } from "@/components/queue/words";

/**
 * Claim and open a case, or open it read only.
 *
 * Every path through here calls requireSession first and reads the pair through
 * the data layer, which puts the session's customer in the where clause. A pair
 * the session cannot see comes back null and the reviewer lands back on the
 * queue with a plain statement, never a 403, because a 403 confirms the case
 * exists.
 *
 * Two things this does not do yet, both of them schema gaps rather than
 * choices. It does not persist the claim: Pair has no claimedByReviewerId,
 * claimedAt or claimExpiresAt column (DESIGN-UI 13.2 gap 1), so there is
 * nothing to write and nothing here pretends otherwise. And because the claim
 * is not persisted, a read only open and a claiming open land on the same
 * route: the case view derives read only from the claim state on the row. When
 * the migration lands, the claim write belongs in lib/data/cases.ts and this
 * action calls it between the read and the redirect, only for mode "claim" and
 * only when the pair is unclaimed. A claim is workflow state rather than
 * evidence, so it stays out of the audit chain either way.
 */
export async function openCase(pairId: string, mode: OpenMode): Promise<void> {
  const session = await requireSession();
  const found = await getCase(session, pairId);
  if (!found) {
    redirect("/queue?notice=unavailable");
  }
  // Claim ownership is enforced here rather than advised on the card: a case
  // another reviewer holds opens read only whatever the reviewer pressed. The
  // intent rides in the URL so the case view can honour it once a claim is a
  // row rather than a fixture.
  const readOnly = mode === "read_only" || found.queue.claim.state === "other";
  redirect(`/cases/${encodeURIComponent(pairId)}${readOnly ? "?open=read_only" : ""}`);
}
