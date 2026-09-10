"use client";

import type { KeyboardEvent } from "react";
import type { Contact, ContactingAccount } from "@/lib/data/people";
import { accountLabel, bandWord, signalWord, whenWords } from "./words";
import styles from "./TargetedCard.module.css";

/**
 * One account, and every account in a younger band it has been talking to.
 *
 * The other direction from TargetedCard, over the same conversations. One
 * conversation is a conversation. The same opening made to five children in a
 * week is the shape the fan-out feature was built to catch, and on a flat list
 * of pairs it is five unrelated rows that nothing connects.
 *
 * This describes an account's traffic and never the person behind it. There is
 * no word here about what somebody is, and there is no threshold at which this
 * card starts saying one (rule 5).
 */

export interface ContactingCardProps {
  account: ContactingAccount;
  selected: boolean;
  pendingPairId: string | null;
  onOpen: (pairId: string, mode: "claim" | "read_only") => void;
  onFocus: () => void;
  cardRef: (element: HTMLDivElement | null) => void;
}

export function ContactingCard({
  account,
  selected,
  pendingPairId,
  onOpen,
  onFocus,
  cardRef,
}: ContactingCardProps) {
  const many = account.minorCount > 1;

  return (
    <li className={styles.item}>
      <div
        ref={cardRef}
        className={styles.card}
        data-tier={account.tier}
        data-many={many ? "true" : undefined}
        tabIndex={selected ? 0 : -1}
        onFocus={onFocus}
      >
        <div className={styles.who}>
          <span className={styles.uid}>{accountLabel(account.uid)}</span>
          <span className={styles.band}>{bandWord(account.band.band)}</span>
        </div>

        <p className={styles.count} data-many={many ? "true" : undefined}>
          {many
            ? `Talking to ${account.minorCount} accounts in a younger band`
            : "Talking to one account in a younger band"}
        </p>

        <ul className={styles.contacts}>
          {account.contacts.map((contact) => (
            <ContactedRow
              key={contact.pairId}
              contact={contact}
              pending={pendingPairId === contact.pairId}
              onOpen={onOpen}
            />
          ))}
        </ul>
      </div>
    </li>
  );
}

function ContactedRow({
  contact,
  pending,
  onOpen,
}: {
  contact: Contact;
  pending: boolean;
  onOpen: (pairId: string, mode: "claim" | "read_only") => void;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      onOpen(contact.pairId, "read_only");
    }
  }

  const critical = contact.criticalSignals[0];

  return (
    <li>
      <button
        type="button"
        className={styles.contact}
        data-tier={contact.tier}
        data-pending={pending ? "true" : undefined}
        aria-busy={pending || undefined}
        onKeyDown={handleKeyDown}
        onClick={(event) => onOpen(contact.pairId, event.shiftKey ? "read_only" : "claim")}
      >
        <span className={styles.contactHead}>
          <span className={styles.contactUid}>{accountLabel(contact.uid)}</span>
          <span className={styles.contactBand}>{bandWord(contact.band.band)}</span>
          <span className={styles.contactWhen}>{whenWords(contact.at)}</span>
        </span>

        <span className={styles.contactWhat}>{contact.patternClause}</span>

        {contact.excerpt ? (
          <span className={styles.contactQuote}>
            <q>{contact.excerpt.text}</q>
          </span>
        ) : null}

        <span className={styles.contactBasis}>
          {critical
            ? `A ${signalWord(critical)}. Serious on its own.`
            : contact.stagesReached > 1
              ? `Walked ${contact.stagesReached} of the 6 grooming steps.`
              : "One step, and it went no further."}
        </span>
      </button>
    </li>
  );
}
