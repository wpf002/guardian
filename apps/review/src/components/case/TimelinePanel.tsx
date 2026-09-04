"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, Timeline } from "@/components";
import type { TimelineState } from "@/lib/data/types";
import styles from "./Case.module.css";

/** A row has to be legible for this long before it counts as read. */
const DWELL_MS = 1000;

export interface TimelinePanelProps {
  pairId: string;
  timeline: TimelineState;
  /** Set when the fetch threw rather than returning a state. */
  error?: string;
  /** Called with the ids of excerpts that became legibly rendered to this reviewer. */
  onExcerptsViewed: (pairId: string, excerptIds: string[]) => Promise<number>;
  /** Called with the new count after each write, so the decision panel can unblock. */
  onReadCountChange: (count: number) => void;
  readCount: number;
}

/**
 * The evidence, and the one place viewedByHuman is written.
 *
 * A flag is written when a row has been legibly rendered to this reviewer for a
 * second, or when they reveal a collapsed span. Never on case open, and never
 * by scrolling past a collapsed span. Reveal-all says how many spans it will
 * open and that it writes those flags, before it opens them.
 *
 * The dwell observer reads the list rows out of the Timeline component's own
 * markup, in order, because Timeline owns the list and exposes no per-row ref.
 * If that markup changes, this degrades to reveal-only rather than to a wrong
 * flag: an observer that finds no rows writes nothing.
 */
export function TimelinePanel({
  pairId,
  timeline,
  error,
  onExcerptsViewed,
  onReadCountChange,
  readCount,
}: TimelinePanelProps) {
  const [revealAll, setRevealAll] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const written = useRef<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () => (timeline.state === "ready" ? timeline.rows : []),
    [timeline],
  );

  const excerptIds = useMemo(
    () => rows.filter((row) => row.media === null).map((row) => row.id),
    [rows],
  );

  const collapsedCount = useMemo(
    () => rows.filter((row) => row.collapsed !== null).length,
    [rows],
  );

  useEffect(() => {
    for (const row of rows) {
      if (row.viewedByHuman) written.current.add(row.id);
    }
  }, [rows]);

  const record = useCallback(
    async (ids: string[]) => {
      const fresh = ids.filter((id) => !written.current.has(id));
      if (fresh.length === 0) return;
      for (const id of fresh) written.current.add(id);
      try {
        await onExcerptsViewed(pairId, fresh);
        setWriteError(null);
      } catch {
        setWriteError(
          "The read flags for this case were not saved. The bundle will say those excerpts were read by nobody.",
        );
      }
      onReadCountChange(written.current.size);
    },
    [onExcerptsViewed, onReadCountChange, pairId],
  );

  // Dwell tracking. Skipped where the browser has no IntersectionObserver: a
  // missing observer means fewer read claims, which is the safe direction.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof IntersectionObserver === "undefined") return;
    if (excerptIds.length === 0) return;

    const timers = new Map<Element, ReturnType<typeof setTimeout>>();
    const items = Array.from(container.querySelectorAll("li[data-speaker]"));
    const idFor = new Map<Element, string>();
    items.forEach((item, index) => {
      const row = rows[index];
      if (row && row.media === null) idFor.set(item, row.id);
    });

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = idFor.get(entry.target);
          if (!id) continue;
          if (entry.isIntersecting) {
            if (timers.has(entry.target)) continue;
            timers.set(
              entry.target,
              setTimeout(() => {
                void record([id]);
              }, DWELL_MS),
            );
          } else {
            const timer = timers.get(entry.target);
            if (timer) clearTimeout(timer);
            timers.delete(entry.target);
          }
        }
      },
      { threshold: 0.6 },
    );

    for (const item of idFor.keys()) observer.observe(item);
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      observer.disconnect();
    };
  }, [excerptIds, record, rows, revealAll]);

  const shown: TimelineState = useMemo(() => {
    if (!revealAll || timeline.state !== "ready") return timeline;
    return { ...timeline, rows: timeline.rows.map((row) => ({ ...row, collapsed: null })) };
  }, [revealAll, timeline]);

  function confirmRevealAll() {
    setRevealAll(true);
    setConfirmOpen(false);
    void record(excerptIds);
  }

  return (
    <section id="timeline" ref={containerRef} aria-label="Evidence timeline">
      <div className={styles.timelineHead}>
        <h2 className={styles.signalName}>Evidence timeline</h2>
        <span className={styles.readCount}>
          {readCount} of {excerptIds.length} excerpts recorded as read by you
        </span>
      </div>

      {collapsedCount > 0 && !revealAll ? (
        <div className={styles.stripActions}>
          <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
            Reveal all in this case
          </Button>
        </div>
      ) : null}

      {writeError ? <p className={styles.note}>{writeError}</p> : null}

      <Timeline
        timeline={shown}
        error={error}
        onReveal={(rowId) => {
          void record([rowId]);
        }}
      />

      <p className={styles.note}>
        Nothing softened is stored. The bundle, the audit chain and any export carry the text
        verbatim, and collapsing is a display layer with no write path.
      </p>

      <Dialog
        open={confirmOpen}
        title="Reveal every collapsed span in this case?"
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Not now
            </Button>
            <Button variant="primary" onClick={confirmRevealAll}>
              Reveal {collapsedCount} span{collapsedCount === 1 ? "" : "s"}
            </Button>
          </>
        }
      >
        <p>
          This opens {collapsedCount} collapsed span{collapsedCount === 1 ? "" : "s"} and records
          every excerpt in this case as read by you. That record is a claim about what a person
          at Guardian saw, and it goes into the bundle.
        </p>
      </Dialog>
    </section>
  );
}
