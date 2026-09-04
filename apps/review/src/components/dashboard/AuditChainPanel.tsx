"use client";

import { useState } from "react";
import { Button } from "@/components";
import styles from "./AuditChainPanel.module.css";

/**
 * The chain head, and a control that walks the chain and names the row that
 * broke.
 *
 * The verification itself runs in a server action passed in as a prop, so this
 * component holds no data access and can be rendered with a stub. Every string
 * it prints was formatted on the server: nothing here formats a date, because
 * the server render and the browser render have to match to the byte.
 */

export interface ChainVerification {
  state: "ok" | "broken" | "unavailable";
  headline: string;
  detail: string;
  checkedAt: string;
}

export interface AuditChainPanelProps {
  headSeq: number;
  /** Already shortened by the caller. */
  headHash: string;
  entriesInWindow: number;
  windowDays: number;
  initial: ChainVerification;
  /** The server action. Reads the chain; writes nothing. */
  verify: () => Promise<ChainVerification>;
}

export function AuditChainPanel({
  headSeq,
  headHash,
  entriesInWindow,
  windowDays,
  initial,
  verify,
}: AuditChainPanelProps) {
  const [result, setResult] = useState<ChainVerification>(initial);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setFailed(null);
    try {
      setResult(await verify());
    } catch {
      setFailed(
        "The verification did not run. Nothing was changed, and the head below is the last one this page read.",
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className={styles.panel}>
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>Chain head</dt>
          <dd className="tabular">entry {headSeq}</dd>
        </div>
        <div className={styles.fact}>
          <dt>Head hash</dt>
          <dd className="mono">{headHash}</dd>
        </div>
        <div className={styles.fact}>
          <dt>Scores written in the last {windowDays} days</dt>
          <dd className="tabular">{entriesInWindow}</dd>
        </div>
      </dl>

      <p className={styles.result} data-state={result.state} role="status">
        <span className={styles.headline}>{result.headline}</span>{" "}
        <span className={styles.detail}>{result.detail}</span>{" "}
        <span className={styles.stamp}>Checked {result.checkedAt}.</span>
      </p>

      {failed ? (
        <p className={styles.failed} role="alert">
          {failed}
        </p>
      ) : null}

      <Button variant="secondary" loading={running} onClick={run}>
        Verify now
      </Button>
    </div>
  );
}
