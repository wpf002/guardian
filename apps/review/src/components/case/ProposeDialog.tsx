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
    ? "Pick the incident type first."
    : missingNote
      ? "The timeline note is empty. Say what in the timeline supports this before you send it."
      : !readClaim || !originClaim
        ? "Both claims have to be true and checked."
        : !imminentOk
          ? "Imminent danger needs a reason in words."
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
      title="Propose a report to a second reviewer"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel, stay at confirm T2
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!ready}
            disabledReason={ready ? undefined : blockedReason}
            onClick={submit}
          >
            Send to a second reviewer
          </Button>
        </>
      }
    >
      <div className={styles.dialogBody}>
        <p className={styles.dialogLead}>
          This proposes a report. It does not create one, and it does not create tier T3.
        </p>

        <ul className={styles.consequences}>
          <li>
            Sending this writes one entry to the hash-chained audit log, carrying your id, the
            incident type, your reasons and notes, which excerpts you read, and the attestation
            below.
          </li>
          <li>
            A second reviewer who is not you sees your reasons and your notes and decides. Only
            their concurrence writes tier T3. Disagreement returns the case to T2 and records a
            quality event, and neither outcome is a finding about a person.
          </li>
          <li>
            If they uphold it, the excerpts move to one-year preservation under 18 USC 2258A
            and a report is drafted for the operator to file at report.cybertip.org. Guardian
            never submits it.
          </li>
        </ul>

        <ConsequenceCopy context="propose" />

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Incident type</legend>
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
          <legend className={styles.legend}>Annotations</legend>
          <label className={styles.radioRow}>
            <input
              type="checkbox"
              checked={sextortion}
              onChange={(event) => setSextortion(event.target.checked)}
            />
            <span>Sextortion pattern present</span>
          </label>
          <label className={styles.radioRow}>
            <input
              type="checkbox"
              checked={imminent}
              onChange={(event) => setImminent(event.target.checked)}
            />
            <span>Imminent danger, which needs a reason</span>
          </label>
          {imminent ? (
            <label className={styles.radioRow}>
              <span className="sr-only">Why this is imminent</span>
              <input
                type="text"
                className={styles.filter}
                value={imminentReason}
                placeholder="Why this is imminent, in one sentence"
                aria-label="Why this is imminent"
                onChange={(event) => setImminentReason(event.target.value)}
              />
            </label>
          ) : null}
        </fieldset>

        <div className={styles.completeness}>
          <span className={styles.completenessLabel}>bundle completeness</span>
          <span>
            {readCount} of {totalExcerpts} excerpts were read by you. The rest were read by
            nobody, and the bundle says so.
          </span>
          {missing.length === 0 ? (
            <span>Nothing is recorded as missing from this bundle.</span>
          ) : (
            <span>Missing: {missing.join("; ")}. Ask the operator for it.</span>
          )}
        </div>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Your claims</legend>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={readClaim}
              disabled={!readBound}
              onChange={(event) => setReadClaim(event.target.checked)}
            />
            <span>
              I read the excerpts marked as read above, and I am not claiming to have read the
              others.
              {readBound ? null : (
                <span className={styles.blocked}>
                  This is unavailable until at least one excerpt has been rendered to you. There
                  is no minimum number to read.
                </span>
              )}
            </span>
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={originClaim}
              onChange={(event) => setOriginClaim(event.target.checked)}
            />
            <span>
              This decision is mine and was not made at the direction of a law enforcement
              request.
            </span>
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
