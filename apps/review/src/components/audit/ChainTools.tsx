"use client";

import { useState } from "react";
import { Button, Card, Field, Toast } from "@/components";
import { MAX_RANGE, type ExportOutcome, type VerifyOutcome } from "./types";
import styles from "./ChainTools.module.css";

/**
 * Verify a range of the chain, and export that range as JSON for counsel.
 *
 * Both actions are passed in rather than imported, so this component can be
 * rendered against stubs in a test and against the server actions in the page.
 * A verification that fails names the entry it broke on, because a bare no is
 * useless to the person who has to explain the chain to somebody else.
 */

export interface ChainToolsProps {
  /** Null when the chain head could not be read. Both controls then say why. */
  headSeq: number | null;
  headHash: string | null;
  headUnavailableReason?: string;
  defaultFrom: number;
  defaultTo: number;
  canExport: boolean;
  /** Printed under the export button when this seat may not export. */
  exportBlockedReason?: string;
  onVerify: (fromSeq: number, toSeq: number) => Promise<VerifyOutcome>;
  onExport: (fromSeq: number, toSeq: number) => Promise<ExportOutcome>;
  /** Hands the file to the browser. Replaced in tests, where there is no download. */
  onDownload?: (outcome: ExportOutcome) => void;
}

function download(outcome: ExportOutcome): void {
  const blob = new Blob([outcome.json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = outcome.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ChainTools({
  headSeq,
  headHash,
  headUnavailableReason,
  defaultFrom,
  defaultTo,
  canExport,
  exportBlockedReason,
  onVerify,
  onExport,
  onDownload = download,
}: ChainToolsProps) {
  const [from, setFrom] = useState(String(defaultFrom));
  const [to, setTo] = useState(String(defaultTo));
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [verdict, setVerdict] = useState<VerifyOutcome | null>(null);
  const [exported, setExported] = useState<ExportOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const chainReadable = headSeq !== null;
  const blockedReason = chainReadable
    ? undefined
    : (headUnavailableReason ?? "The chain head could not be read on this deployment.");

  function readRange(): { from: number; to: number } | null {
    const first = Number.parseInt(from, 10);
    const last = Number.parseInt(to, 10);
    if (!Number.isFinite(first) || !Number.isFinite(last)) {
      setRangeError("Both boxes take a sequence number, like 1.");
      return null;
    }
    if (first < 1) {
      setRangeError("The chain starts at #1.");
      return null;
    }
    if (last < first) {
      setRangeError("The last entry has to be at or after the first.");
      return null;
    }
    if (last - first + 1 > MAX_RANGE) {
      setRangeError(`One run covers at most ${MAX_RANGE} entries. Narrow the range.`);
      return null;
    }
    setRangeError(null);
    return { from: first, to: last };
  }

  async function runVerify() {
    const range = readRange();
    if (!range) return;
    setVerifying(true);
    setFailure(null);
    try {
      setVerdict(await onVerify(range.from, range.to));
    } catch {
      setVerdict(null);
      setFailure("The chain could not be read just now. Nothing was written. Try again.");
    } finally {
      setVerifying(false);
    }
  }

  async function runExport() {
    const range = readRange();
    if (!range) return;
    setExporting(true);
    setFailure(null);
    try {
      const outcome = await onExport(range.from, range.to);
      setVerdict(outcome.verification);
      setExported(outcome);
      try {
        onDownload(outcome);
      } catch {
        setFailure(
          "The file was built and recorded, but this browser would not take the download. The entries are on this page.",
        );
      }
    } catch {
      setFailure("The export did not run. Nothing was written to the chain. Try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Card
      title="Verify and export"
      aside={
        chainReadable && headHash ? `head ${headSeq} · ${headHash.slice(0, 12)}...` : undefined
      }
      density="padded"
    >
      <p className={styles.lede}>
        A verification walks the range entry by entry and checks that each one hashes to what it
        recorded and points at the one before it. The export carries that verdict, the range, and
        every entry in it that this seat can read.
      </p>

      <div className={styles.range}>
        <Field
          id="audit-from"
          label="First entry"
          type="number"
          inputMode="numeric"
          min={1}
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          help="Sequence number to start at."
          error={rangeError ?? undefined}
        />
        <Field
          id="audit-to"
          label="Last entry"
          type="number"
          inputMode="numeric"
          min={1}
          value={to}
          onChange={(event) => setTo(event.target.value)}
          help={`Up to ${MAX_RANGE} entries in one run.`}
        />
      </div>

      <div className={styles.actions}>
        <Button
          variant="primary"
          loading={verifying}
          disabledReason={blockedReason}
          onClick={runVerify}
        >
          Verify this range
        </Button>
        <Button
          variant="secondary"
          loading={exporting}
          disabledReason={
            blockedReason ??
            (canExport
              ? undefined
              : (exportBlockedReason ??
                "An operator seat exports the chain. Yours can read and verify it."))
          }
          onClick={runExport}
        >
          Export this range as JSON
        </Button>
      </div>

      <div className={styles.result} role="status" aria-live="polite">
        {failure ? <p className={styles.failure}>{failure}</p> : null}
        {verdict ? (
          <p className={verdict.ok ? styles.verified : styles.broken} data-ok={String(verdict.ok)}>
            {verdict.sentence}
          </p>
        ) : null}
        {!failure && !verdict ? (
          <p className={styles.idle}>
            No verification has been run on this range in this session.
          </p>
        ) : null}
      </div>

      {exported ? (
        <Toast
          message={exported.sentence}
          tone={exported.verification.ok ? "success" : "warning"}
          onDismiss={() => setExported(null)}
        />
      ) : null}
    </Card>
  );
}
