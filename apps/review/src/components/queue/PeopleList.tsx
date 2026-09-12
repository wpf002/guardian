"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { KeyboardHelp } from "@/components/KeyboardHelp";
import type { ContactingAccount, TargetedAccount } from "@/lib/data/people";
import type { QueueCase } from "@/lib/data/types";
import { CaseCard } from "./CaseCard";
import { ContactingCard } from "./ContactingCard";
import { TargetedCard } from "./TargetedCard";
import type { OpenMode } from "./words";
import styles from "./PeopleList.module.css";

/**
 * The three readings of one set of conversations, and the way between them.
 *
 * Guardian scores pairs. A pair answers "were these two accounts talking", and
 * the console showed nothing else, so three accounts working on the same child
 * were three unrelated rows and one account working on five children was five.
 * Both of those are the thing this product exists to see.
 *
 * So: the same cases grouped three ways, switched here rather than on three
 * routes, because they are one dataset read from three sides and a reader
 * moving between them is comparing, not navigating.
 */

export type View = "targeted" | "contacting" | "conversations";

export interface PeopleListProps {
  targeted: TargetedAccount[];
  contacting: ContactingAccount[];
  cases: QueueCase[];
  /** Conversations no grouping claims: the bands did not separate the two. */
  unmatched: QueueCase[];
  /** The server action that opens a case. A claim is a write and happens there. */
  open: (pairId: string, mode: OpenMode) => void | Promise<void>;
}

/** No binding fires while focus is in a text field (DESIGN-UI 12). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/*
 * Two words each, and no two start the same way.
 *
 * These read "Who Is Being Contacted", "Who Is Doing the Contacting" and
 * "Every Conversation": eleven words of tab strip describing three readings of
 * one list. The long labels named what a reader would work out from the first
 * card in under a second. The accessible name on each list still says it in
 * full, for somebody who cannot see the cards.
 */
const VIEW_WORDS: Record<View, string> = {
  targeted: "Being Contacted",
  contacting: "Contacting",
  conversations: "Conversations",
};

export function PeopleList({ targeted, contacting, cases, unmatched, open }: PeopleListProps) {
  const [view, setView] = useState<View>("targeted");
  const [selected, setSelected] = useState(0);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [opening, startTransition] = useTransition();
  const cardRefs = useRef<Array<HTMLElement | null>>([]);
  // Focus follows j and k, and never moves on mount or on a re-render.
  const wantsFocus = useRef(false);

  const length =
    view === "targeted" ? targeted.length : view === "contacting" ? contacting.length : cases.length;

  useEffect(() => {
    if (!wantsFocus.current) return;
    wantsFocus.current = false;
    cardRefs.current[selected]?.focus();
  }, [selected]);

  const openCase = useCallback(
    (pairId: string, mode: OpenMode) => {
      // One open at a time. A second press while a write is in flight would
      // claim a second case behind the reviewer's back.
      if (opening) return;
      setPendingId(pairId);
      startTransition(() => {
        void open(pairId, mode);
      });
    },
    [open, opening],
  );

  useEffect(() => {
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
      if (length === 0) return;

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        move(Math.min(selected + 1, length - 1));
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        move(Math.max(selected - 1, 0));
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [length, selected]);

  function pick(next: View) {
    setView(next);
    setSelected(0);
    cardRefs.current = [];
  }

  return (
    <>
      {/*
        Three readings of one dataset, not three destinations. A tab keeps the
        reader in place; a nav entry per view would put the same conversations
        behind three rail items and lose the fact that they are the same ones.
      */}
      <div className={styles.views} role="tablist" aria-label="How to read these conversations">
        {(Object.keys(VIEW_WORDS) as View[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            className={styles.view}
            data-active={view === key ? "true" : undefined}
            onClick={() => pick(key)}
          >
            {VIEW_WORDS[key]}
          </button>
        ))}
      </div>

      {view === "targeted" ? (
        <ul className={styles.list} aria-label="Accounts being contacted">
          {targeted.map((account, index) => (
            <TargetedCard
              key={account.uid}
              account={account}
              selected={index === selected}
              pendingPairId={pendingId}
              onOpen={openCase}
              onFocus={() => setSelected(index)}
              cardRef={(element) => {
                cardRefs.current[index] = element;
              }}
            />
          ))}
        </ul>
      ) : null}

      {view === "contacting" ? (
        <ul className={styles.list} aria-label="Accounts doing the contacting">
          {contacting.map((account, index) => (
            <ContactingCard
              key={account.uid}
              account={account}
              selected={index === selected}
              pendingPairId={pendingId}
              onOpen={openCase}
              onFocus={() => setSelected(index)}
              cardRef={(element) => {
                cardRefs.current[index] = element;
              }}
            />
          ))}
        </ul>
      ) : null}

      {view === "conversations" ? (
        <ul className={styles.list} aria-label="Every conversation">
          {cases.map((item, index) => (
            <CaseCard
              key={item.pairId}
              item={item}
              selected={index === selected}
              pending={pendingId === item.pairId}
              onFocus={() => setSelected(index)}
              onOpen={(mode) => openCase(item.pairId, mode)}
              cardRef={(element) => {
                cardRefs.current[index] = element;
              }}
            />
          ))}
        </ul>
      ) : null}

      {/*
        Conversations neither grouping claims: two accounts in the same band, or
        two with no band at all. They are real conversations somebody flagged,
        and dropping them because the ages did not separate would hide exactly
        the bridged game chat where both sides read unknown.
      */}
      {view !== "conversations" && unmatched.length > 0 ? (
        <section className={styles.unmatched} aria-label="Conversations with no age difference recorded">
          {/*
            A heading and a paragraph became one line. The heading named the
            reason, the paragraph restated it and then argued for reading them,
            which is what putting them on the page already says.
          */}
          <h2 className={styles.unmatchedTitle}>
            {unmatched.length === 1 ? "1 more" : `${unmatched.length} more`}
            <span className={styles.unmatchedWhy}>No age difference recorded</span>
          </h2>
          <ul className={styles.list}>
            {unmatched.map((item) => (
              <CaseCard
                key={item.pairId}
                item={item}
                selected={false}
                pending={pendingId === item.pairId}
                onFocus={() => undefined}
                onOpen={(mode) => openCase(item.pairId, mode)}
                cardRef={() => undefined}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <KeyboardHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
