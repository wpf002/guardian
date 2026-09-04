"use client";

import { useState, type ReactNode } from "react";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import styles from "./Timeline.module.css";
import type { NormalizationHit, TimelineRow, TimelineState } from "@/lib/data/types";

const SPAN_WORDS: Record<string, string> = {
  explicit: "explicit content",
  threat: "threat language",
  coercion: "coercion language",
  payment_coercion: "payment coercion",
};

const SPEAKER_WORDS: Record<string, string> = {
  t: "t",
  s1: "s1",
  s2: "s2",
};

function formatTime(at: Date): string {
  return at.toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Renders the excerpt with the normalized tokens marked inline. A reviewer who
 * cannot see that a rewritten token fired the signal cannot tell a true hit
 * from a lexicon bug, so normalization is shown rather than hidden.
 */
function renderText(text: string, normalizations: NormalizationHit[]): ReactNode {
  if (normalizations.length === 0) return text;
  let parts: ReactNode[] = [text];
  normalizations.forEach((hit, hitIndex) => {
    const next: ReactNode[] = [];
    for (const part of parts) {
      if (typeof part !== "string") {
        next.push(part);
        continue;
      }
      const segments = part.split(hit.normalized);
      segments.forEach((segment, index) => {
        if (index > 0) {
          next.push(
            <button
              key={`norm-${hitIndex}-${index}`}
              type="button"
              className={styles.normalized}
              title={`Normalized from ${hit.original}. Lexicon ${hit.lexiconVersion}, entry ${hit.entry}.`}
              aria-label={`${hit.normalized}, normalized from ${hit.original}, lexicon ${hit.lexiconVersion}, entry ${hit.entry}`}
            >
              {hit.normalized}
            </button>,
          );
        }
        if (segment) next.push(segment);
      });
    }
    parts = next;
  });
  return parts;
}

export interface TimelineProps {
  timeline: TimelineState;
  /**
   * Called when an excerpt becomes legibly rendered to this reviewer. This is
   * the viewedByHuman write path, and it is a claim about a private search
   * rather than an engagement metric, so it fires on reveal and on nothing else.
   */
  onReveal?: (rowId: string) => void;
  /** Retry for the error state. Manual only. */
  onRetry?: () => void;
  /** Set when the fetch failed rather than returning a state. */
  error?: string;
}

export function Timeline({ timeline, onReveal, onRetry, error }: TimelineProps) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  function reveal(rowId: string) {
    setRevealed((current) => {
      if (current.has(rowId)) return current;
      const next = new Set(current);
      next.add(rowId);
      return next;
    });
    onReveal?.(rowId);
  }

  if (error) {
    return (
      <div className={styles.wrap} role="alert">
        <p>{error}</p>
        {onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </div>
    );
  }

  if (timeline.state === "expired") {
    return (
      <EmptyState
        title="The excerpts for this case were deleted under the retention rule."
        detail="The features and the tier remain. An expired case is a normal outcome."
        meta={
          timeline.deletedOn
            ? `Deleted ${timeline.deletedOn.toLocaleDateString()}.`
            : undefined
        }
      />
    );
  }

  if (timeline.state === "empty") {
    return (
      <EmptyState
        title="No excerpts are attached to this case."
        detail="The tier was assigned from features alone. There is nothing here to read."
      />
    );
  }

  const { rows, messageCount, collapsedThirdParty } = timeline;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span>
          Evidence timeline &middot; {messageCount} messages
          {collapsedThirdParty > 0
            ? ` · ${collapsedThirdParty} third-party rows collapsed`
            : ""}
        </span>
        <span>Collapse: explicit spans, threats, payment coercion</span>
      </div>
      <ol className={styles.list}>
        {rows.map((row) => (
          <TimelineRowView
            key={row.id}
            row={row}
            revealed={revealed.has(row.id)}
            onReveal={() => reveal(row.id)}
          />
        ))}
      </ol>
    </div>
  );
}

function TimelineRowView({
  row,
  revealed,
  onReveal,
}: {
  row: TimelineRow;
  revealed: boolean;
  onReveal: () => void;
}) {
  return (
    <>
      {row.gapHoursBefore ? (
        <li className={styles.gap} aria-label={`${row.gapHoursBefore} hours, no messages`}>
          <span>{row.gapHoursBefore} hours, no messages</span>
        </li>
      ) : null}
      <li className={styles.row} data-speaker={row.speaker}>
        <span className={styles.speaker}>{SPEAKER_WORDS[row.speaker] ?? row.speaker}</span>
        <div>
          <div className={styles.meta}>
            <span>{formatTime(row.at)}</span>
            <span>{row.bandLabel}</span>
            {row.stage ? (
              <span className={row.lowConfidence ? styles.low : styles.stage}>
                stage {row.stage}
                {row.confidence !== null ? ` · ${row.confidence.toFixed(2)}` : ""}
                {row.lowConfidence ? " · low confidence" : ""}
              </span>
            ) : null}
          </div>

          {row.media ? <MediaRow row={row} /> : null}

          {row.collapsed && !revealed ? (
            <p className={styles.text}>
              <button type="button" className={styles.collapsed} onClick={onReveal}>
                {SPAN_WORDS[row.collapsed.spanClass] ?? row.collapsed.spanClass},{" "}
                {row.collapsed.wordCount} words
                <span aria-hidden="true">&middot;</span> reveal
              </button>
            </p>
          ) : null}

          {row.text && (!row.collapsed || revealed) ? (
            <p className={styles.text}>{renderText(row.text, row.normalizations)}</p>
          ) : null}

          {row.collapsed && revealed && !row.text ? (
            <p className={styles.text}>
              This excerpt is not loaded. The bundle holds it verbatim.
            </p>
          ) : null}

          {row.normalizations.length > 0 ? (
            <span className={styles.normalizedNote}>
              {row.normalizations
                .map(
                  (hit) =>
                    `normalized from ${hit.original}, lexicon ${hit.lexiconVersion}, entry ${hit.entry}`,
                )
                .join(" · ")}
            </span>
          ) : null}

          {row.signals.length > 0 ? (
            <p className={styles.signals}>{row.signals.join(", ").replace(/_/g, " ")}</p>
          ) : null}
        </div>
      </li>
    </>
  );
}

/**
 * Four lines. Direction in words, the truncated hash, the operator's verdict,
 * and the human-viewed flag as a full sentence, because it is load-bearing
 * legal metadata and a reviewer skimming checkmarks will miss it. The fifth
 * line is CLAUDE.md rule 1 expressed as interface.
 */
function MediaRow({ row }: { row: TimelineRow }) {
  const media = row.media!;
  const direction =
    media.direction === "older_to_younger"
      ? "older band to younger band"
      : "younger band to older band";
  const verdict =
    media.verdict === "match"
      ? "match"
      : media.verdict === "no_match"
        ? "no match"
        : "not run";
  return (
    <div className={styles.media}>
      <span>Media event, {direction}.</span>
      <span className={styles.hash}>sha256:{media.sha256.slice(0, 8)}&hellip;{media.sha256.slice(-4)}</span>
      <span>Operator verdict: {verdict}.</span>
      <span>
        Viewed by a person at the operator: {media.viewedByOperatorHuman ? "yes" : "no"}.
      </span>
      <span className={styles.noImage}>
        Guardian holds no image and there is nothing here to open.
      </span>
    </div>
  );
}
