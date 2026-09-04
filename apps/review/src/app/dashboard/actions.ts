"use server";

import { requireRole } from "@/lib/auth";
import { runVerification } from "./metrics";
import { describeVerification, type VerificationDisplay } from "./verification";

/**
 * Walk the audit chain on demand.
 *
 * DESIGN.md 10 says tampering with a stored evidence row must make verification
 * fail and name the row. This is where that becomes something a customer can
 * run rather than something a test asserts. It reads; it writes nothing, and it
 * deliberately does not append to the chain, because a verification is not one
 * of the nine audit kinds and inventing a tenth to log a read would dilute the
 * record it is checking.
 *
 * Operator and owner only. A reviewer who reaches this gets the not-found state
 * rather than a 403, the same as the page itself.
 */
export async function verifyChainNow(): Promise<VerificationDisplay> {
  await requireRole("operator");
  const view = await runVerification(new Date());
  return describeVerification(view);
}
