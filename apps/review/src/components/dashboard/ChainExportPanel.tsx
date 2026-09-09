"use client";

import { useState } from "react";
import { Button } from "@/components";
import styles from "./AuditChainPanel.module.css";

/**
 * Produce the independently verifiable audit export.
 *
 * The artifact is built by a server action and handed back as a string, which
 * this saves through a blob url. It is deliberately not a route: the artifact
 * is scoped to the caller's own customer and a GET url is a thing people paste
 * into a ticket, where it would be a link to somebody else's evidence for
 * anyone holding a session.
 *
 * No key is involved on this path. Producing an export needs none, and the
 * artifact says so in its own verification block rather than shipping one.
 */

export interface ChainExportResult {
  ok: boolean;
  artifact: string | null;
  filename: string | null;
  headline: string;
  detail: string;
}

export interface ChainExportPanelProps {
  /** The server action. Reads the chain; writes nothing. */
  exportChain: (purpose?: string) => Promise<ChainExportResult>;
  /** Injected in tests, where no blob url exists. */
  save?: (filename: string, contents: string) => void;
}

function saveToDisk(filename: string, contents: string): void {
  const url = window.URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

export function ChainExportPanel({ exportChain, save = saveToDisk }: ChainExportPanelProps) {
  const [purpose, setPurpose] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ChainExportResult | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const produced = await exportChain(purpose);
      setResult(produced);
      if (produced.ok && produced.artifact && produced.filename) {
        save(produced.filename, produced.artifact);
      }
    } catch {
      setResult({
        ok: false,
        artifact: null,
        filename: null,
        headline: "The export did not run.",
        detail: "Nothing was produced and nothing was changed.",
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.field}>
        <label htmlFor="export-purpose">Why This Export Is Being Produced</label>
        <input
          id="export-purpose"
          type="text"
          value={purpose}
          maxLength={200}
          placeholder="Independent assessment of safety measure effectiveness"
          onChange={(event) => setPurpose(event.target.value)}
        />
        <span className={styles.detail}>
          Written into the artifact so a reader a year from now knows what they were sent. Optional.
        </span>
      </div>

      {result ? (
        <p className={styles.result} data-state={result.ok ? "ok" : "broken"} role="status">
          <span className={styles.headline}>{result.headline}</span>{" "}
          <span className={styles.detail}>{result.detail}</span>
        </p>
      ) : null}

      <Button variant="secondary" loading={running} onClick={() => void run()}>
        Produce an Export
      </Button>
    </div>
  );
}
