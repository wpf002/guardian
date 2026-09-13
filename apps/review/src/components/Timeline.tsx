"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { announce } from "@/lib/announce";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import styles from "./Timeline.module.css";
import type { NormalizationHit, Speaker, TimelineRow, TimelineState } from "@/lib/data/types";
import { signalWord } from "./queue/words";

/** What a hidden message is, said plainly. */
const SPAN_WORDS: Record<string, string> = {
  explicit: "sexual content",
  threat: "a threat",
  coercion: "pressure to do something",
  payment_coercion: "a demand for money",
};

/*
 * Speakers are the ML service's tags: t is the account whose messages were
 * scored, s1 the account they were sent to. The rows printed those tags as
 * the speaker's name, so a conversation read "t: hey you were funny" and
 * "s1: haha thanks". The case page passes the two accounts' names in.
 */
const FALLBACK_SPEAKER: Record<Speaker, string> = {
  t: "First account",
  s1: "Second account",
  s2: "Another account",
};

/** The six steps grooming usually follows (DESIGN.md 1), as a person says them. */
const STEP_WORDS: Record<string, string> = {
  contact: "Started talking",
  trust: "Built trust",
  probe: "Asked whether anyone is watching",
  migrate: "Asked to move to another app",
  sexualize: "Made it sexual",
  coerce: "Pressured or threatened",
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
          // A span, not a button. It was a <button> with no handler, which put
          // a dead tab stop in the timeline for every normalized token and
          // announced each one as activatable. The mark is the underline, the
          // title is a mouse convenience, and the note printed under the row is
          // the path that works for everybody.
          next.push(
            <span
              key={`norm-${hitIndex}-${index}`}
              className={styles.normalized}
              title={`Written as ${hit.original}`}
            >
              {hit.normalized}
            </span>,
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
  /** The accounts' names, keyed by speaker tag, so no row is labelled "t". */
  speakerNames?: Partial<Record<Speaker, string>>;
}

export function Timeline({ timeline, onReveal, onRetry, error, speakerNames = {} }: TimelineProps) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  function reveal(rowId: string) {
    setRevealed((current) => {
      if (current.has(rowId)) return current;
      const next = new Set(current);
      next.add(rowId);
      return next;
    });
    const row = timeline.state === "ready" ? timeline.rows.find((r) => r.id === rowId) : undefined;
    const span = row?.collapsed;
    // Text appearing without a focus move or a word is a no-op to a screen
    // reader, so the reveal says what opened.
    announce(span ? `Showing ${SPAN_WORDS[span.spanClass] ?? "a hidden message"}.` : "Showing a hidden message.");
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
        title="These messages were deleted on schedule."
        detail={
          timeline.deletedOn
            ? `Guardian deleted them on ${timeline.deletedOn.toLocaleDateString()}.`
            : "Guardian only keeps messages for a set time."
        }
      />
    );
  }

  if (timeline.state === "empty") {
    return (
      <EmptyState
        title="There are no messages to show."
        detail="Guardian flagged this without keeping any of the messages."
      />
    );
  }

  const { rows, messageCount, collapsedThirdParty } = timeline;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span>
          {messageCount} {messageCount === 1 ? "message" : "messages"}
          {collapsedThirdParty > 0
            ? `, and ${collapsedThirdParty} from other people hidden`
            : ""}
        </span>
      </div>
      <ol className={styles.list}>
        {rows.map((row) => (
          <TimelineRowView
            key={row.id}
            row={row}
            speaker={speakerNames[row.speaker] ?? FALLBACK_SPEAKER[row.speaker] ?? row.speaker}
            revealed={revealed.has(row.id)}
            onReveal={() => reveal(row.id)}
          />
        ))}
      </ol>
    </div>
  );
}

/**
 * One row.
 *
 * The body is the focus anchor and it never unmounts, so revealing a collapsed
 * span cannot drop focus to the document. The control that opened the span does
 * unmount, which is exactly why focus has to move somewhere that stays: without
 * this, the next Tab after a reveal restarts at the top of the document, past
 * the rail, the strip and the why panel.
 */
function TimelineRowView({
  row,
  speaker,
  revealed,
  onReveal,
}: {
  row: TimelineRow;
  speaker: string;
  revealed: boolean;
  onReveal: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const wasRevealed = useRef(revealed);

  useEffect(() => {
    if (revealed && !wasRevealed.current) bodyRef.current?.focus();
    wasRevealed.current = revealed;
  }, [revealed]);

  return (
    <>
      {row.gapHoursBefore ? (
        <li className={styles.gap} aria-label={`${row.gapHoursBefore} hours later`}>
          <span>{row.gapHoursBefore} hours later</span>
        </li>
      ) : null}
      <li className={styles.row} data-speaker={row.speaker}>
        <span className={styles.speaker}>{speaker}</span>
        <div ref={bodyRef} tabIndex={-1} className={styles.body}>
          {/*
            The time, where it was said when that is not an open channel, and
            which step this message was, in words. It printed the age range, the
            stage code and a confidence to two decimals on every line, so a
            conversation read like a log file.
          */}
          <div className={styles.meta}>
            <span>{formatTime(row.at)}</span>
            {row.channelVisibility !== "public" ? (
              <span className={styles.visibility}>
                {row.channelVisibility === "group" ? "group message" : "private message"}
              </span>
            ) : null}
            {row.stage && !row.lowConfidence ? (
              <span className={styles.stage}>{STEP_WORDS[row.stage] ?? row.stage}</span>
            ) : null}
          </div>

          {row.media ? <MediaRow row={row} /> : null}

          {row.collapsed && !revealed ? (
            <p className={styles.text}>
              <button type="button" className={styles.collapsed} onClick={onReveal}>
                {`Hidden: ${SPAN_WORDS[row.collapsed.spanClass] ?? "a message"}. Show it`}
              </button>
            </p>
          ) : null}

          {row.text && (!row.collapsed || revealed) ? (
            <p className={styles.text}>{renderText(row.text, row.normalizations)}</p>
          ) : null}

          {row.collapsed && revealed && !row.text ? (
            <p className={styles.text}>This message couldn&apos;t be loaded. Reload the page to try again.</p>
          ) : null}

          {row.normalizations.length > 0 ? (
            <span className={styles.normalizedNote}>
              {row.normalizations.map((hit) => `"${hit.original}" means "${hit.normalized}"`).join(" · ")}
            </span>
          ) : null}

          {/* Only when the step above did not already say it. */}
          {row.signals.length > 0 && !(row.stage && !row.lowConfidence) ? (
            <p className={styles.signals}>
              {row.signals.map((code) => capitalize(signalWord(code))).join(". ")}
            </p>
          ) : null}
        </div>
      </li>
    </>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * An image or video in the conversation.
 *
 * It printed "Media event, older band to younger band", a truncated sha256,
 * "Operator verdict: match" and a sentence on the human-viewed flag. What a
 * person needs is who sent it, what their own scanner said, and whether anyone
 * on their team has looked. Whether a person looked is kept, because a report
 * has to say so. Guardian never holds the image (rule 1).
 */
function MediaRow({ row }: { row: TimelineRow }) {
  const media = row.media!;
  const direction =
    media.direction === "older_to_younger" ? "The older account sent an image." : "The younger account sent an image.";
  const verdict =
    media.verdict === "match"
      ? "Your scanner matched it to a known image."
      : media.verdict === "no_match"
        ? "Your scanner didn't match it to anything."
        : "It wasn't scanned.";
  return (
    <div className={styles.media}>
      <span>{direction}</span>
      <span>{verdict}</span>
      <span>
        {media.viewedByOperatorHuman
          ? "Someone on your team has looked at it."
          : "Nobody on your team has looked at it yet."}
      </span>
      <span className={styles.noImage}>Guardian never keeps images.</span>
    </div>
  );
}
