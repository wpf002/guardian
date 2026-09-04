"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { KeyboardHelp } from "@/components/KeyboardHelp";
import type { QueueCase } from "@/lib/data/types";
import { CaseCard } from "./CaseCard";
import type { OpenMode } from "./words";
import styles from "./QueueList.module.css";

export interface QueueListProps {
  cases: QueueCase[];
  /**
   * The server action that opens a case. A claim is a write, so it happens
   * there, behind requireSession and the data layer, never in this component.
   */
  open: (pairId: string, mode: OpenMode) => void | Promise<void>;
  /** Test seam. Defaults to the wall clock. */
  now?: () => number;
}

/** No binding fires while focus is in a text field (DESIGN-UI 12). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * The ranked list, its selection and its keyboard map.
 *
 * j and k move the selection and neither opens nor claims. Enter or o claims
 * and opens the selected case, Shift+Enter opens it read only. Selection is a
 * roving tabindex over the cards, because the card is the tab stop rather than
 * anything inside it.
 */
export function QueueList({ cases, open, now }: QueueListProps) {
  const clock = now ?? Date.now;
  const [selected, setSelected] = useState(0);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [agedMinutes, setAgedMinutes] = useState(0);
  const [opening, startTransition] = useTransition();
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Focus follows j and k, and never moves on mount or on a re-render.
  const wantsFocus = useRef(false);

  useEffect(() => {
    if (!wantsFocus.current) return;
    wantsFocus.current = false;
    cardRefs.current[selected]?.focus();
  }, [selected]);

  // The SLA figures age in place rather than by refetching, from the moment
  // this list mounted. Minutes and not seconds: a ticking second counter is a
  // stopwatch, and the SLA is a property of the queue.
  useEffect(() => {
    const openedAt = clock();
    const timer = setInterval(() => {
      setAgedMinutes(Math.max(0, Math.floor((clock() - openedAt) / 60_000)));
    }, 30_000);
    return () => clearInterval(timer);
  }, [clock]);

  const openCase = useCallback(
    (index: number, mode: OpenMode) => {
      const item = cases[index];
      // One open at a time. A second press while a write is in flight would
      // claim a second case behind the reviewer's back.
      if (!item || opening) return;
      setPendingId(item.pairId);
      startTransition(() => {
        void open(item.pairId, mode);
      });
    },
    [cases, open, opening],
  );

  useEffect(() => {
    // At either end of the list the selection holds and focus comes to it, so
    // j and k always land somewhere rather than doing nothing visible.
    function move(next: number) {
      if (next === selected) {
        cardRefs.current[selected]?.focus();
        return;
      }
      wantsFocus.current = true;
      setSelected(next);
    }

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      if (event.key === "?") {
        setHelpOpen(true);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (cases.length === 0) return;

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        move(Math.min(selected + 1, cases.length - 1));
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        move(Math.max(selected - 1, 0));
      } else if (event.key === "o") {
        event.preventDefault();
        openCase(selected, "claim");
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cases.length, openCase, selected]);

  return (
    <>
      <ul className={styles.list} aria-label="Cases waiting for review">
        {cases.map((item, index) => (
          <CaseCard
            key={item.pairId}
            item={item}
            selected={index === selected}
            pending={opening && pendingId === item.pairId}
            agedMinutes={agedMinutes}
            onFocus={() => setSelected(index)}
            onOpen={(mode) => openCase(index, mode)}
            cardRef={(element) => {
              cardRefs.current[index] = element;
            }}
          />
        ))}
      </ul>
      <p className={styles.hint}>
        j and k move the selection. Enter claims and opens the selected case, Shift+Enter opens it
        without claiming. Press ? for every shortcut.
      </p>
      <KeyboardHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
