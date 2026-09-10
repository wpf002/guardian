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
export function QueueList({ cases, open }: QueueListProps) {
  const [selected, setSelected] = useState(0);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [opening, startTransition] = useTransition();
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Focus follows j and k, and never moves on mount or on a re-render.
  const wantsFocus = useRef(false);

  useEffect(() => {
    if (!wantsFocus.current) return;
    wantsFocus.current = false;
    cardRefs.current[selected]?.focus();
  }, [selected]);

  // No timer. The row prints the clock time a case is due by, computed once on
  // the server, so nothing here re-renders six rows every thirty seconds to
  // decrement six deadlines nobody is acting on.

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
            onFocus={() => setSelected(index)}
            onOpen={(mode) => openCase(index, mode)}
            cardRef={(element) => {
              cardRefs.current[index] = element;
            }}
          />
        ))}
      </ul>
      {/*
        The shortcut legend that sat under the list is gone. The keys still work
        and ? still opens the full sheet; printing the instructions under every
        queue, on every load, teaches a reviewer nothing after the first day and
        puts a paragraph of interface copy at the bottom of a page of cases.
      */}
      <KeyboardHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
