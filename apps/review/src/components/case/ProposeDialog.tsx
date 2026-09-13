"use client";

import { useState } from "react";
import { Button, Dialog } from "@/components";
import { PROPOSE_ANNOTATIONS, reasonsFor, type ProposeAnnotation } from "@/lib/reasons";
import { ConsequenceCopy } from "./ConsequenceCopy";
import styles from "./Decision.module.css";

export interface ProposePayload {
  reasonCode: string;
  annotations: ProposeAnnotation[];
  imminentDangerReason?: string;
  lawEnforcementRequested: boolean;
}

export interface ProposeDialogProps {
  open: boolean;
  onClose: () => void;
  busy: boolean;
  readCount: number;
  totalExcerpts: number;
  /** Empty when the timeline note has been written. */
  missingNote: boolean;
  /** Things the bundle does not carry, named one by one. */
  missing: string[];
  onSubmit: (payload: ProposePayload) => void;
}

const CONFIRM_WORD = "PROPOSE";

/**
 * The T3 confirmation step (DESIGN-UI 8.5).
 *
 * Submitting this writes nothing to the tier. It writes a proposal and one
 * audit entry, and moves the case to a second reviewer. The consequences of the
 * step after this one are spelled out here rather than discovered later,
 * because the reviewer pressing this is the person who has to be able to
 * explain it afterwards.
 */
export function ProposeDialog({
  open,
  onClose,
  busy,
  readCount,
  totalExcerpts,
  missingNote,
  missing,
  onSubmit,
}: ProposeDialogProps) {
  const reasons = reasonsFor("report");
  const [reasonCode, setReasonCode] = useState(reasons[0]?.code ?? "");
  const [sextortion, setSextortion] = useState(false);
  const [imminent, setImminent] = useState(false);
  const [imminentReason, setImminentReason] = useState("");
  const [readClaim, setReadClaim] = useState(false);
  const [originClaim, setOriginClaim] = useState(false);
  const [typed, setTyped] = useState("");

  const readBound = readCount > 0;
  const imminentOk = !imminent || imminentReason.trim().length > 0;
  const ready =
    Boolean(reasonCode) &&
    readClaim &&
    originClaim &&
    imminentOk &&
    !missingNote &&
    typed.trim() === CONFIRM_WORD;

  const blockedReason = !reasonCode
    ? "Pick what kind of report this is."
    : missingNote
      ? "Say what in the conversation made you decide, in the box on the page."
      : !readClaim || !originClaim
        ? "Check both boxes."
        : !imminentOk
          ? "Say why a child may be in danger."
          : typed.trim() !== CONFIRM_WORD
            ? `Type ${CONFIRM_WORD} to confirm.`
            : undefined;

  function submit() {
    const annotations: ProposeAnnotation[] = [];
    if (sextortion) annotations.push(PROPOSE_ANNOTATIONS.SEXTORTION_PATTERN);
    if (imminent) annotations.push(PROPOSE_ANNOTATIONS.IMMINENT_DANGER);
    onSubmit({
      reasonCode,
      annotations,
      imminentDangerReason: imminent ? imminentReason.trim() : undefined,
      lawEnforcementRequested: false,
    });
  }

  return (
    <Dialog
      open={open}
      title="Report this?"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!ready}
            disabledReason={ready ? undefined : blockedReason}
            onClick={submit}
          >
            Ask a Teammate to Agree
          </Button>
        </>
      }
    >
      <div className={styles.dialogBody}>
        {/*
          One sentence on what this does. There were three bullets on the
          hash-chained audit log, who writes T3, and 18 USC 2258A.
        */}
        <p className={styles.dialogLead}>
          Nothing is reported until someone else on your team reads this and agrees.
        </p>

        <ConsequenceCopy context="propose" />

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>What Kind of Report Is This?</legend>
          {reasons.map((reason) => (
            <label key={reason.code} className={styles.radioRow}>
              <input
                type="radio"
                name="incident-type"
                value={reason.code}
                checked={reasonCode === reason.code}
                onChange={() => setReasonCode(reason.code)}
              />
              <span>
                <span className={styles.optionLabel}>{reason.label}</span>
                <span className={styles.optionDefinition}> {reason.definition}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Anything Else?</legend>
          <label className={styles.radioRow}>
            <input
              type="checkbox"
              checked={sextortion}
              onChange={(event) => setSextortion(event.target.checked)}
            />
            <span>They&apos;re threatening to share sexual images</span>
          </label>
          <label className={styles.radioRow}>
            <input
              type="checkbox"
              checked={imminent}
              onChange={(event) => setImminent(event.target.checked)}
            />
            <span>A child may be in danger right now</span>
          </label>
          {imminent ? (
            <label className={styles.radioRow}>
              <span className="sr-only">Why a child may be in danger</span>
              <input
                type="text"
                className={styles.filter}
                value={imminentReason}
                placeholder="Why, in one sentence"
                aria-label="Why a child may be in danger"
                onChange={(event) => setImminentReason(event.target.value)}
              />
            </label>
          ) : null}
        </fieldset>

        <div className={styles.completeness}>
          <span>
            {`You've read ${readCount} of the ${totalExcerpts} messages.`}
          </span>
          {missing.length > 0 ? <span>{`Still missing: ${missing.join("; ")}.`}</span> : null}
        </div>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Please Confirm</legend>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={readClaim}
              disabled={!readBound}
              onChange={(event) => setReadClaim(event.target.checked)}
            />
            <span>
              I read the messages I opened, and I&apos;m not saying I read any others.
              {readBound ? null : (
                <span className={styles.blocked}>Read at least one message first.</span>
              )}
            </span>
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={originClaim}
              onChange={(event) => setOriginClaim(event.target.checked)}
            />
            <span>This is my own decision. No police or government agency asked me to make it.</span>
          </label>
        </fieldset>

        <label className={styles.check}>
          <span>
            Type {CONFIRM_WORD} to confirm
            <input
              type="text"
              className={styles.filter}
              value={typed}
              aria-label={`Type ${CONFIRM_WORD} to confirm`}
              onChange={(event) => setTyped(event.target.value)}
            />
          </span>
        </label>
      </div>
    </Dialog>
  );
}
