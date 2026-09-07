"use client";

import type { KeyboardEvent } from "react";
import type { QueueCase } from "@/lib/data/types";
import {
  agesClause,
  basisClause,
  claimClause,
  dueClause,
  sentenceCase,
  speakerWord,
  trajectoryClause,
  SUPPORT_POSTURE_NOTE,
  type OpenMode,
} from "./words";
import styles from "./CaseCard.module.css";

export interface CaseCardProps {
  item: QueueCase;
  /** The card is the tab stop, not its contents, so selection is a roving tabindex. */
  selected: boolean;
  /** A write is in flight for this card. */
  pending: boolean;
  onOpen: (mode: OpenMode) => void;
  onFocus: () => void;
  cardRef: (element: HTMLButtonElement | null) => void;
}

/**
 * One queue row.
 *
 * The reviewer is answering one question here and only one: is this worth my
 * next twenty minutes. Everything on the row exists to answer that, and the
 * order is what happened, then what was said, then what it rests on, then who
 * the two accounts are.
 *
 * Three things this row does that the last one did not.
 *
 * It carries a line of the conversation. A description of a grooming
 * conversation is a worse basis for opening one than a line of it, and the
 * whole product exists to get a person to look at the actual words. The line is
 * chosen server-side and is never the worst thing said: threat and sextortion
 * language stays collapsed behind an explicit reveal on the case page, so the
 * queue takes the earliest recognisable move instead.
 *
 * It separates what fired from what was inferred. A critical signal is a rule
 * that forces a review whatever the score says; everything else is the model's
 * reading. Every triage discipline that puts a number in front of a person has
 * been burned by the person deferring to it, and here the human deciding is not
 * a preference, it is the legal posture.
 *
 * And it is not the same shape for every case. A T1 watch item and a T2 with a
 * threat match are not the same object and should not occupy the same space; a
 * case somebody else is holding is worth none of your attention and takes one
 * line. Shape follows tier and claim state, never the score, because a layout
 * driven by the score is the model telling the reviewer what to skip.
 */
export function CaseCard({ item, selected, pending, onOpen, onFocus, cardRef }: CaseCardProps) {
  const claimedElsewhere = item.claim.state === "other";
  const resolved = item.resolvedAt !== null;
  const brief = claimedElsewhere || resolved;
  const full = item.tier === "T2" || item.tier === "T3";
  const support = item.suggestedPosture === "support";
  const due = dueClause(item.tier, item.createdAt, item.slaRemainingMinutes, resolved);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    // Shift+Enter opens without claiming. Enter alone is the button's own click.
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      onOpen("read_only");
    }
  }

  return (
    <li className={styles.item}>
      <button
        type="button"
        ref={cardRef}
        tabIndex={selected ? 0 : -1}
        className={styles.card}
        data-tier={item.tier}
        data-shape={brief ? "struck" : full ? "full" : "brief"}
        data-unread={item.unread ? "true" : undefined}
        data-pending={pending ? "true" : undefined}
        aria-busy={pending || undefined}
        onFocus={onFocus}
        onKeyDown={handleKeyDown}
        onClick={(event) => onOpen(event.shiftKey ? "read_only" : "claim")}
      >
        {/*
          The support posture reframes the whole case, so it goes above the
          headline rather than beside it: the account this tier describes is
          itself in a minor band, and a reviewer who reads the headline first
          and the posture second has already read it wrong (ROADMAP S4).
        */}
        {support && !brief ? <span className={styles.reframe}>{SUPPORT_POSTURE_NOTE}</span> : null}

        <span className={styles.headline}>{item.patternClause}</span>

        {item.excerpt && !brief ? (
          <span className={styles.excerpt}>
            <q>{item.excerpt.text}</q>
            <span className={styles.excerptFrom}>{speakerWord(item.excerpt.from)}</span>
          </span>
        ) : null}

        {full && !brief ? (
          <span className={styles.basis}>
            <span className={styles.fired}>{basisClause(item.criticalSignals)}</span>{" "}
            <span className={styles.inferred}>
              {trajectoryClause(item.stagesReached, item.spanHours)}
            </span>
          </span>
        ) : null}

        {full && !brief ? (
          <span className={styles.who}>
            {agesClause(item.actorBand, item.targetBand)}{" "}
            {sentenceCase(item.actorContext)}
          </span>
        ) : null}

        <span className={styles.caption}>
          <span className={styles.captionLeft}>
            <span>{item.tier}</span>
            <span className="mono">{item.shortId}</span>
            {pending ? <span>opening</span> : null}
            {claimedElsewhere ? <span>{claimClause(item.claim)}</span> : null}
            {resolved ? <span>resolved</span> : null}
          </span>
          <span className={styles.due} data-urgent={due.urgent ? "true" : undefined}>
            {due.text}
          </span>
        </span>
      </button>
    </li>
  );
}
