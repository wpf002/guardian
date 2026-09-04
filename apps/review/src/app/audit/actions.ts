"use server";

/**
 * The two writes and reads this view is allowed to make against the chain.
 *
 * Both check the session first. Verification is a read and anybody with a seat
 * can run it. The export is an operator act: it produces a document for
 * counsel, and it records itself in the chain, because DESIGN.md section 7 says
 * every export goes through the log.
 */

import { requireRole, type Session } from "@/lib/auth";
import { compose } from "@/lib/compose";
import {
  appendAudit,
  getAuditHead,
  listAuditEntries,
  verifyAuditChain,
} from "@/lib/data/audit";
import { MAX_RANGE, type ExportOutcome, type VerifyOutcome } from "@/components/audit/types";

/** The most rows a single export will pull while it narrows to the range. */
const MAX_FETCH = 2000;

const REASON_WORDS: Record<string, string> = {
  hash_mismatch: "the entry does not match its recorded hash",
  link_mismatch: "the entry does not point at the entry before it",
  sequence_gap: "a sequence number is missing",
  root_mismatch: "the first entry does not point at the chain root",
};

interface Range {
  from: number;
  to: number;
  limit: number;
}

/** Clamps to a sane, bounded window. A bad number becomes a small window, never an error page. */
function clampRange(fromSeq: number, toSeq: number): Range {
  const from = Number.isFinite(fromSeq) ? Math.max(1, Math.floor(fromSeq)) : 1;
  const wanted = Number.isFinite(toSeq) ? Math.floor(toSeq) : from;
  const to = Math.max(from, Math.min(wanted, from + MAX_RANGE - 1));
  return { from, to, limit: to - from + 1 };
}

function shortHash(hash: string): string {
  return hash.length <= 16 ? hash : `${hash.slice(0, 12)}...`;
}

async function verifyRange(range: Range): Promise<VerifyOutcome> {
  const result = await verifyAuditChain(range.from, range.limit);
  if (result.ok) {
    return {
      ok: true,
      fromSeq: range.from,
      toSeq: range.to,
      checked: result.checked,
      sentence: compose(
        "audit.verify",
        `Verified. ${result.checked} entries checked from #${range.from}, ending at hash ${shortHash(result.head)}.`,
      ),
    };
  }
  const why = REASON_WORDS[result.reason] ?? "the chain could not be followed";
  console.error(
    `[guardian] audit chain verification failed at #${result.brokenAt}: ${result.detail}`,
  );
  return {
    ok: false,
    fromSeq: range.from,
    toSeq: range.to,
    checked: result.checked,
    brokenAt: result.brokenAt,
    sentence: compose(
      "audit.verify",
      // The verifier's detail names the entry's kind and the customer that
      // wrote it, and seq spans every customer, so it is logged rather than
      // printed to whichever seat ran the check.
      `The chain does not verify. Entry #${result.brokenAt} is where it breaks: ${why}. ${result.checked} entries before it verified.`,
    ),
  };
}

/** Walks the range and names the row that broke, rather than returning a bare no. */
export async function verifyRangeAction(fromSeq: number, toSeq: number): Promise<VerifyOutcome> {
  // Operator, matching the export. The chain is not partitioned by customer, so
  // walking arbitrary windows of it is not a reviewer-level read.
  await requireRole("operator");
  return verifyRange(clampRange(fromSeq, toSeq));
}

interface ExportEntry {
  seq: number;
  ts: string;
  kind: string;
  customerId: string;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

function exportDocument(
  session: Session,
  range: Range,
  verification: VerifyOutcome,
  head: { seq: number; hash: string },
  entries: ExportEntry[],
  truncated: boolean,
) {
  return {
    document: "guardian_audit_chain_export",
    version: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: {
      reviewerId: session.reviewerId,
      displayName: session.displayName,
      role: session.role,
    },
    customerId: session.customerId,
    range: { fromSeq: range.from, toSeq: range.to },
    verification: {
      ok: verification.ok,
      checked: verification.checked,
      brokenAt: verification.brokenAt ?? null,
      statement: verification.sentence,
    },
    headAtExport: head,
    entryCount: entries.length,
    truncated,
    notes: [
      "Sequence numbers are assigned across every customer, so a verification walks the chain as a whole. The entries below are the ones this seat can read.",
      "The chain carries hashes, tiers, model and lexicon versions, identifiers and reviewer decisions. It carries no message text.",
      "Guardian emits risk tiers and evidence bundles for human review. Nothing in this document is a finding about a person.",
    ],
    entries,
  };
}

/**
 * Builds the document for counsel, then records the export in the chain. The
 * verification runs here rather than trusting whatever the browser last saw, so
 * the document states the verdict of the range at the moment it was written.
 */
export async function exportRangeAction(fromSeq: number, toSeq: number): Promise<ExportOutcome> {
  const session = await requireRole("operator");
  const range = clampRange(fromSeq, toSeq);
  const verification = await verifyRange(range);
  const head = await getAuditHead();

  // The data layer reads newest first from a starting sequence, so the fetch
  // starts at the range and narrows down to it here. A toSeq option would make
  // this exact rather than bounded: see the note in the handover.
  const reach = Math.min(MAX_FETCH, Math.max(range.limit, head.seq - range.from + 1));
  const fetched = await listAuditEntries(session, { fromSeq: range.from, limit: reach });
  const truncated = fetched.length >= MAX_FETCH;
  const entries: ExportEntry[] = fetched
    .filter((entry) => entry.seq <= range.to)
    .sort((a, b) => a.seq - b.seq)
    .map((entry) => ({
      seq: entry.seq,
      ts: entry.ts.toISOString(),
      kind: entry.kind,
      customerId: entry.customerId,
      payload: entry.payload,
      prevHash: entry.prevHash,
      hash: entry.hash,
    }));

  const json = JSON.stringify(
    exportDocument(session, range, verification, head, entries, truncated),
    null,
    2,
  );

  const recorded = await appendAudit(session, {
    kind: "bundle.exported",
    payload: {
      exportOf: "audit_chain_range",
      fromSeq: range.from,
      toSeq: range.to,
      entryCount: entries.length,
      verified: verification.ok,
      brokenAt: verification.brokenAt ?? null,
      exportedByReviewerId: session.reviewerId,
      headSeqAtExport: head.seq,
    },
  });

  return {
    filename: `guardian-audit-${session.customerId}-${range.from}-${range.to}.json`,
    json,
    entryCount: entries.length,
    verification,
    recordedSeq: recorded.seq,
    sentence: compose(
      "audit.export",
      `${entries.length} entries from #${range.from} to #${range.to} are in the file. The export was recorded in the chain as #${recorded.seq}.`,
    ),
  };
}
