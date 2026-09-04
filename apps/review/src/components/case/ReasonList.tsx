"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components";
import { reasonsFor, type Reason } from "@/lib/reasons";
import type { ReviewDecision } from "@/lib/data/types";
import styles from "./Decision.module.css";

export interface ReasonListProps {
  decision: ReviewDecision;
  title: string;
  busy?: boolean;
  onCommit: (reason: Reason) => void;
  onCancel: () => void;
}

/**
 * The reason chip is the submit (DESIGN-UI 8.1). Pressing a verb opens this
 * list already focused; typing filters it, the arrows move within it, and Enter
 * is the write. A required reason arriving after the decision is a second
 * dialog a reviewer learns to dismiss, so there is no separate confirm step
 * here.
 */
export function ReasonList({ decision, title, busy = false, onCommit, onCancel }: ReasonListProps) {
  const all = useMemo(() => reasonsFor(decision), [decision]);
  const [filter, setFilter] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (reason) =>
        reason.label.toLowerCase().includes(needle) ||
        reason.definition.toLowerCase().includes(needle),
    );
  }, [all, filter]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // The highlight is clamped rather than reset from an effect, so a filter that
  // shortens the list cannot leave the selection pointing past its end.
  const position = matches.length === 0 ? 0 : Math.min(index, matches.length - 1);
  const active = matches[position];

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex((i) => (matches.length === 0 ? 0 : (i + 1) % matches.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex((i) => (matches.length === 0 ? 0 : (i - 1 + matches.length) % matches.length));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (active && !busy) onCommit(active);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  }

  const listId = `reasons-${decision}`;

  return (
    <div className={styles.reasons}>
      <div className={styles.reasonHead}>
        <span className={styles.reasonTitle} id={`${listId}-title`}>
          {title}
        </span>
        <span className={styles.optionDefinition}>
          Type to filter, arrows to move, Enter to record the decision.
        </span>
      </div>

      <input
        ref={inputRef}
        type="text"
        className={styles.filter}
        value={filter}
        placeholder="Filter reasons"
        aria-label="Filter reasons"
        aria-controls={listId}
        aria-activedescendant={active ? `${listId}-${active.code}` : undefined}
        onChange={(event) => {
          setFilter(event.target.value);
          setIndex(0);
        }}
        onKeyDown={onKeyDown}
      />

      {matches.length === 0 ? (
        <p className={styles.emptyFilter}>
          No reason matches that. Clear the filter to see the whole set.
        </p>
      ) : (
        <ul className={styles.options} role="listbox" id={listId} aria-labelledby={`${listId}-title`}>
          {matches.map((reason, optionIndex) => (
            <li
              key={reason.code}
              id={`${listId}-${reason.code}`}
              role="option"
              aria-selected={optionIndex === position}
              className={styles.option}
              onMouseEnter={() => setIndex(optionIndex)}
              onClick={() => {
                if (!busy) onCommit(reason);
              }}
            >
              <span className={styles.optionLabel}>{reason.label}</span>
              <span className={styles.optionDefinition}>{reason.definition}</span>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.reasonActions}>
        <Button
          variant="primary"
          loading={busy}
          disabled={!active}
          disabledReason={active ? undefined : "Pick a reason first. Every decision carries one."}
          onClick={() => {
            if (active) onCommit(active);
          }}
        >
          Record this decision
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Close, decide nothing
        </Button>
      </div>
    </div>
  );
}
