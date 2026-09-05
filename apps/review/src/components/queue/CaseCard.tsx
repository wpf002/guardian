"use client";

import type { KeyboardEvent } from "react";
import { TierBadge } from "@/components/TierBadge";
import type { QueueCase } from "@/lib/data/types";
import {
  BREACH_RISK_MINUTES,
  bandsClause,
  claimClause,
  criticalClause,
  slaClause,
  SUPPORT_POSTURE_CHIP,
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
  /** Minutes the page has been open, so the SLA text ages without a refetch. */
  agedMinutes: number;
  onOpen: (mode: OpenMode) => void;
  onFocus: () => void;
  cardRef: (element: HTMLButtonElement | null) => void;
}

/**
 * One queue row: a tier, a sentence, and a quiet line of context.
 *
 * The sentence is the card. It is the largest thing on it and the only thing at
 * full ink, because the decision a reviewer makes here is only ever "is this
 * worth opening", and that is answered by what happened, not by the pair id or
 * the claim state.
 *
 * Not on this card, deliberately: the fused score, the actor skew value, any
 * percentage, any handle, any avatar, any excerpt. A queue you can read without
 * reading anybody's words is the point.
 */
export function CaseCard({
  item,
  selected,
  pending,
  agedMinutes,
  onOpen,
  onFocus,
  cardRef,
}: CaseCardProps) {
  const remaining =
    item.slaRemainingMinutes === null ? null : item.slaRemainingMinutes - agedMinutes;
  const atBreachRisk = remaining !== null && remaining <= BREACH_RISK_MINUTES;
  const claimedElsewhere = item.claim.state === "other";
  const support = item.suggestedPosture === "support";

  // The badge already says a critical signal fired, and the headline often names
  // the same one. Printing it again is noise, so it appears only when it adds
  // something the headline did not already say.
  const critical = criticalClause(item.criticalSignals);
  const criticalAddsSomething =
    critical !== null && !item.patternClause.toLowerCase().includes(critical.toLowerCase());

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
        data-unread={item.unread ? "true" : undefined}
        data-claimed-elsewhere={claimedElsewhere ? "true" : undefined}
        data-pending={pending ? "true" : undefined}
        aria-busy={pending || undefined}
        onFocus={onFocus}
        onKeyDown={handleKeyDown}
        onClick={(event) => onOpen(event.shiftKey ? "read_only" : "claim")}
      >
        <span className={styles.tierCell}>
          <TierBadge tier={item.tier} criticalSignals={item.criticalSignals} />
        </span>

        <span className={styles.headline}>{item.patternClause}</span>

        <span className={`${styles.timeCell} tabular`}>
          <span>{slaClause(remaining)}</span>
          {atBreachRisk ? <span className={styles.breach}>breach risk</span> : null}
        </span>

        <span className={styles.meta}>
          <span>{bandsClause(item.actorBand, item.targetBand)}</span>
          {criticalAddsSomething ? <span>{critical}</span> : null}
          {support ? <span className={styles.posture}>{SUPPORT_POSTURE_CHIP}</span> : null}
          <span>{support ? SUPPORT_POSTURE_NOTE : item.actorContext}</span>
          <span className={styles.pairId}>Pair <span className="mono">{item.shortId}</span></span>
          <span className={styles.claim}>{pending ? "opening" : claimClause(item.claim)}</span>
        </span>
      </button>
    </li>
  );
}
