"use server";

import { requireRole } from "@/lib/auth";
import { buildChainExport } from "./metrics";
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

export interface ChainExportResult {
  ok: boolean;
  /** The artifact as JSON, ready to save. Null when the export refused. */
  artifact: string | null;
  /** Suggested filename, so the browser saves something a reader can identify. */
  filename: string | null;
  /** One sentence for the operator, whether it worked or not. */
  headline: string;
  detail: string;
}

/**
 * Produce the independently verifiable audit export (ROADMAP P-7).
 *
 * exportChain and verifyExport shipped in phase 3 with no surface, which meant
 * an operator asked for a regulator export had no way to produce one. This is
 * that way.
 *
 * Three properties are worth stating because they are what make the artifact
 * usable and safe. It is scoped to the caller's own customer, so rule 8 holds
 * and other customers' rows travel as withheld placeholders that keep the chain
 * linkable without disclosing anything. It carries the recomputation recipe, so
 * a regulator verifies it with an ordinary HMAC and none of Guardian's code.
 * And it never contains the chain key: producing an export needs no key at all,
 * which is why this action can run in a process that has none.
 */
export async function exportChainNow(purpose?: string): Promise<ChainExportResult> {
  const session = await requireRole("operator");
  try {
    const artifact = await buildChainExport(session, purpose);
    const stamp = artifact.header.exportedAt.slice(0, 19).replace(/[:T]/g, "");
    return {
      ok: true,
      artifact: JSON.stringify(artifact, null, 2),
      filename: `guardian-audit-${session.customerId}-${stamp}.json`,
      headline: `${artifact.header.range.entryCount} entries, sequence ${artifact.header.range.fromSeq} to ${artifact.header.range.toSeq}.`,
      detail:
        artifact.header.range.withheldCount === 0
          ? "Verify it with the chain key, delivered separately. The artifact carries the recipe and no key."
          : `Verify it with the chain key, delivered separately. ${artifact.header.range.withheldCount} entries belong to other customers and travel as placeholders that keep the chain linkable without disclosing anything.`,
    };
  } catch (err) {
    return {
      ok: false,
      artifact: null,
      filename: null,
      headline: "The export could not be produced.",
      detail: err instanceof Error ? err.message : "Unknown failure.",
    };
  }
}
