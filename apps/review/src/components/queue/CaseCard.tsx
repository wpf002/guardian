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
 * One queue row. Three lines, never four (DESIGN-UI 6). Line one is identity
 * and routing, line two the pattern, line three time and actor context.
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
          <TierBadge tier={item.tier} variant="bar" criticalSignals={item.criticalSignals} />
        </span>

        <span className={styles.lineOne}>
          <span className={`${styles.pairId} mono`}>Pair {item.shortId}</span>
          <span className={styles.critical}>{criticalClause(item.criticalSignals)}</span>
          {support ? <span className={styles.posture}>{SUPPORT_POSTURE_CHIP}</span> : null}
          <span className={styles.claim}>
            {pending ? "opening" : claimClause(item.claim)}
          </span>
        </span>

        <span className={styles.lineTwo}>
          <span className={styles.pattern}>{item.patternClause}</span>
          <span className={styles.bands}>{bandsClause(item.actorBand, item.targetBand)}</span>
        </span>

        <span className={styles.lineThree}>
          <span>{support ? SUPPORT_POSTURE_NOTE : item.actorContext}</span>
          <span className={`${styles.sla} tabular`}>
            {slaClause(remaining)}
            {atBreachRisk ? <span className={styles.breach}>at breach risk</span> : null}
          </span>
        </span>
      </button>
    </li>
  );
}
