"use client";

import type { KeyboardEvent } from "react";
import type { Contact, TargetedAccount } from "@/lib/data/people";
import { accountLabel, bandWord, proposalClause, signalWord, whenWords } from "./words";
import styles from "./TargetedCard.module.css";

/**
 * One account being contacted, and everyone contacting it.
 *
 * This replaces a card that showed one conversation. A conversation is
 * Guardian's unit and not a person's: a child three accounts were working on
 * produced three unrelated cards, and the fact that mattered most about that
 * child, that it was three and not one, was on no screen in the product.
 *
 * The order is who, then how many, then each conversation newest first. The
 * headline is the child, because the child is what the console is for.
 *
 * Nothing here says anything about who either account belongs to. It reports a
 * recorded age band, an account identifier and what was said, which is what the
 * mod-channel alert has always carried (rule 5).
 */

export interface TargetedCardProps {
  account: TargetedAccount;
  selected: boolean;
  pendingPairId: string | null;
  onOpen: (pairId: string, mode: "claim" | "read_only") => void;
  onFocus: () => void;
  cardRef: (element: HTMLDivElement | null) => void;
}

export function TargetedCard({
  account,
  selected,
  pendingPairId,
  onOpen,
  onFocus,
  cardRef,
}: TargetedCardProps) {
  const many = account.contacts.length > 1;
  const waiting = account.contacts.find((contact) => contact.proposal)?.proposal ?? null;

  return (
    <li className={styles.item}>
      <div
        ref={cardRef}
        className={styles.card}
        data-tier={account.tier}
        data-many={many ? "true" : undefined}
        data-unread={account.unread ? "true" : undefined}
        tabIndex={selected ? 0 : -1}
        onFocus={onFocus}
      >
        <div className={styles.who}>
          <span className={styles.uid}>{accountLabel(account.uid)}</span>
          <span className={styles.band}>{bandWord(account.band.band)}</span>
          {account.channels.length > 0 ? (
            <span className={styles.where}>{account.channels.join(", ")}</span>
          ) : null}
        </div>

        {/*
          The count, and only when it is more than one.
          
          Two accounts approaching the same child is the strongest thing this
          product can say, and it was not on any screen before this card. One
          account is the ordinary case, and "One account has been talking to
          this account" is a sentence naming what the single row below it
          already shows, using the word account twice to do it.
        */}
        {many ? (
          <p className={styles.count} data-many="true">
            {`${account.contacts.length} accounts are talking to this one`}
          </p>
        ) : null}

        {/*
          Names the reviewer and when, rather than saying "waiting". A second
          reviewer who has to open the case to find out who proposed it and how
          long ago has been told nothing by the row.
        */}
        {waiting ? <p className={styles.waiting}>{proposalClause(waiting)}</p> : null}

        <ul className={styles.contacts}>
          {account.contacts.map((contact) => (
            <ContactRow
              key={contact.pairId}
              contact={contact}
              pending={pendingPairId === contact.pairId}
              /* Only worth marking when there is more than one row to tell apart.
                 On a single row the clause above already names it. */
              markWaiting={many}
              onOpen={onOpen}
            />
          ))}
        </ul>
      </div>
    </li>
  );
}

function ContactRow({
  contact,
  pending,
  markWaiting,
  onOpen,
}: {
  contact: Contact;
  pending: boolean;
  markWaiting: boolean;
  onOpen: (pairId: string, mode: "claim" | "read_only") => void;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    // Shift+Enter opens without claiming. Enter alone is the button's own click.
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

        {/*
          One line under the quote, and it is what forced a person to look. A
          critical signal is a rule that fires whatever the score says, so it
          outranks the stage count and is the only thing said when it is there.
        */}
        <span className={styles.contactBasis}>
          {critical
            ? `A ${signalWord(critical)}. Serious on its own.`
            : contact.stagesReached > 1
              ? `Walked ${contact.stagesReached} of the 6 grooming steps.`
              : "One step, and it went no further."}
        </span>

        {markWaiting && contact.proposal ? (
          <span className={styles.contactWaiting}>Waiting on a second person</span>
        ) : null}
      </button>
    </li>
  );
}
