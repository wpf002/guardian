"use client";

import { useState } from "react";
import { Button, Card } from "@/components";
import type { CaseSignal } from "./signals";
import styles from "./Case.module.css";

export interface SignalListProps {
  signals: CaseSignal[];
  lexiconVersion: string;
}

function when(at: Date | null): string {
  if (!at) return "not in the excerpts";
  return at.toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Every signal that fired, with the lexicon entry that rewrote the token where
 * the normalizer left one.
 *
 * The numbers sit behind a disclosure. A fusion term and a lexicon hit are not
 * the same object, so printing a weight beside a matched token reads as an
 * attribution the scorer never made. A reviewer who wants the number asks for
 * it and gets the caveat with it.
 */
export function SignalList({ signals, lexiconVersion }: SignalListProps) {
  const [showWeights, setShowWeights] = useState(false);

  return (
    <Card title="Signals" aside={`lexicon ${lexiconVersion}`} density="padded">
      <div className={styles.toggleRow}>
        <span className={styles.note}>
          {signals.length} signal{signals.length === 1 ? "" : "s"} on this pair.
        </span>
        <Button
          variant="ghost"
          aria-expanded={showWeights}
          onClick={() => setShowWeights((value) => !value)}
        >
          {showWeights ? "Hide the weights" : "Show the weights"}
        </Button>
      </div>

      {signals.length === 0 ? (
        <p className={styles.note}>
          No signal fired on this pair. The tier came from elsewhere, and the pair panel says
          from where.
        </p>
      ) : (
        <ul className={styles.signals}>
          {signals.map((signal) => (
            <li key={signal.kind} className={styles.signal}>
              <span className={styles.signalName}>
                {signal.label}
                {signal.critical ? (
                  <span className={styles.criticalWord}> · critical</span>
                ) : null}
              </span>
              <span className={styles.signalMeta}>
                {signal.occurrences} occurrence{signal.occurrences === 1 ? "" : "s"} · first at{" "}
                {when(signal.firstAt)}
              </span>
              {signal.lexicon.length === 0 ? (
                <span className={styles.signalEntry}>
                  No lexicon entry rewrote a token for this signal.
                </span>
              ) : (
                signal.lexicon.map((entry) => (
                  <span key={entry.entry} className={styles.signalEntry}>
                    matched <code>{entry.entry}</code> in lexicon {entry.lexiconVersion}, which
                    rewrote {entry.original} to {entry.normalized}
                  </span>
                ))
              )}
              {showWeights ? (
                <span className={styles.signalMeta}>
                  {signal.weight === null
                    ? "No fusion term carries this signal's name on its own."
                    : `Fusion term ${signal.weight.toFixed(2)}, matched to this signal by name.`}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {showWeights ? (
        <p className={styles.note}>
          A weight here is the fusion term whose name matches the signal. Where the scorer made
          no such term, the row says so rather than printing a zero.
        </p>
      ) : null}
    </Card>
  );
}
