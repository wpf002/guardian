"use client";

import { useState } from "react";
import { Button, Card } from "@/components";
import { CYBERTIPLINE_URL } from "./cybertipline";
import { filingHeadline, type FilingReadiness } from "./filing";
import {
  INCIDENT_TYPE_NOTES,
  NCMEC_INCIDENT_TYPES,
  type NcmecIncidentType,
} from "./incident-types";
import styles from "./Case.module.css";

export interface ReportDraftProps {
  pairId: string;
  /** Plain text, built on the server from the bundle. */
  draft: string;
  /** The type the recorded signals derived, before anybody chose one. */
  derivedIncidentType: NcmecIncidentType;
  /** False when nothing matched, so the derived type is a fallback. */
  incidentTypeDerived: boolean;
  /** What would stop this report being routed and acted on. */
  readiness: FilingReadiness;
  /** The two accounts on the pair, as salted hashes, and the band of each. */
  accounts: { actorUid: string; targetUid: string };
  /** What to call each account on screen. The ids above are what gets recorded. */
  names: { actor: string; target: string };
  actorBandLabel: string;
  targetBandLabel: string;
  /** The account a reviewer has designated, or null while nobody has. */
  reportedSubjectUid: string | null;
  /** Records the designation and rebuilds the draft under it, on the server. */
  onDesignateSubject: (pairId: string, uid: string) => Promise<{ draft: string }>;
  /** Records the export on the hash chain. Guardian still submits nothing. */
  onExport: (pairId: string, method: "copy" | "download") => Promise<{ ok: boolean }>;
  /**
   * Rebuild the draft under a chosen incident type. A server action: the draft
   * is built from the bundle, and the bundle stays on the server.
   */
  onIncidentType: (pairId: string, incidentType: NcmecIncidentType) => Promise<{ draft: string }>;
}

/**
 * The drafted bundle, for an owner who is the reporter of record.
 *
 * There is no submit button here and there is no CyberTipline client behind
 * this screen. The owner copies or downloads the text and files it themselves.
 * Taking it out of the app is an export, so it lands on the audit chain.
 */
export function ReportDraft({
  pairId,
  draft,
  derivedIncidentType,
  incidentTypeDerived,
  readiness,
  accounts,
  names,
  actorBandLabel,
  targetBandLabel,
  reportedSubjectUid,
  onExport,
  onIncidentType,
  onDesignateSubject,
}: ReportDraftProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<"copy" | "download" | null>(null);
  const [incidentType, setIncidentType] = useState<NcmecIncidentType>(derivedIncidentType);
  const [subject, setSubject] = useState<string | null>(reportedSubjectUid);
  const [designating, setDesignating] = useState(false);
  const [text, setText] = useState(draft);
  const [redrafting, setRedrafting] = useState(false);
  const chosen = incidentType !== derivedIncidentType;

  async function chooseIncidentType(next: NcmecIncidentType) {
    setIncidentType(next);
    setRedrafting(true);
    try {
      const { draft: rebuilt } = await onIncidentType(pairId, next);
      setText(rebuilt);
      setStatus(null);
    } catch {
      // The selection stays, the text does not lie about it.
      setStatus(
        "The report couldn't be updated. Reload the page before you send it.",
      );
    } finally {
      setRedrafting(false);
    }
  }

  async function copy() {
    setBusy("copy");
    try {
      if (!navigator.clipboard?.writeText) {
        setStatus(
          "Copying isn't available in this browser. Select the text and copy it yourself.",
        );
        return;
      }
      await navigator.clipboard.writeText(text);
      await onExport(pairId, "copy");
      setStatus("Copied.");
    } catch {
      setStatus("Copying didn't work. Select the text and copy it yourself.");
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    setBusy("download");
    try {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `guardian-${pairId}-cybertipline-draft.txt`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      await onExport(pairId, "download");
      setStatus("Downloaded.");
    } catch {
      setStatus("Downloading didn't work. Select the text and copy it instead.");
    } finally {
      setBusy(null);
    }
  }

  async function designate(uid: string) {
    setDesignating(true);
    try {
      const { draft: rebuilt } = await onDesignateSubject(pairId, uid);
      setSubject(uid);
      setText(rebuilt);
      setStatus(null);
    } catch {
      setStatus(
        "That didn't save. No account is picked yet.",
      );
    } finally {
      setDesignating(false);
    }
  }

  return (
    <Card title="Your Report" density="padded">
      {/*
        It said "This goes to NCMEC, not to the police." NCMEC's own reporting
        page tells anyone with a child in immediate danger to call 911 or local
        police, so this says that first.
      */}
      <p className={styles.note}>
        Guardian wrote this report. You send it yourself at{" "}
        <a href={CYBERTIPLINE_URL} rel="noreferrer noopener" target="_blank">
          report.cybertip.org
        </a>
        . If a child is in danger right now, call 911 or your local police first.
      </p>

      <fieldset className={styles.subject} disabled={designating}>
        <legend>Who is this report about?</legend>
        <p className={styles.note}>
          Pick the account you&apos;re reporting. Guardian doesn&apos;t choose, because the account
          that set this off is sometimes the child.
        </p>
        {(
          [
            { uid: accounts.actorUid, name: names.actor, band: actorBandLabel },
            { uid: accounts.targetUid, name: names.target, band: targetBandLabel },
          ] as const
        ).map((option) => (
          <label key={option.uid} className={styles.subjectOption}>
            <input
              type="radio"
              name={`subject-${pairId}`}
              value={option.uid}
              checked={subject === option.uid}
              onChange={() => void designate(option.uid)}
            />
            <span>{`${option.name}, ${option.band}`}</span>
          </label>
        ))}
        {subject === null ? (
          <p className={styles.note} role="status">
            No account picked yet.
          </p>
        ) : null}
      </fieldset>

      <div className={styles.readiness} data-ready={readiness.readyToFile ? "yes" : "no"}>
        <p className={styles.readinessHeadline}>{filingHeadline(readiness)}</p>
        {readiness.gaps.length > 0 ? (
          <ul className={styles.readinessList}>
            {readiness.gaps.map((gap) => (
              <li key={gap.what} data-severity={gap.severity}>
                <span className={styles.gapWhat}>{gap.what}.</span>{" "}
                <span className={styles.gapGather}>{gap.gather}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className={styles.incident}>
        <label htmlFor={`incident-${pairId}`}>Kind of report</label>
        <select
          id={`incident-${pairId}`}
          value={incidentType}
          disabled={redrafting}
          onChange={(event) => void chooseIncidentType(event.target.value as NcmecIncidentType)}
        >
          {NCMEC_INCIDENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <p className={styles.note}>{INCIDENT_TYPE_NOTES[incidentType]}</p>
        <p className={styles.note}>
          {chosen
            ? "You picked this."
            : incidentTypeDerived
              ? "Guardian suggested this from the conversation. Change it if it's wrong."
              : "Guardian couldn't tell. Pick the kind that fits before you send it."}
        </p>
      </div>

      <label className="sr-only" htmlFor={`draft-${pairId}`}>
        The report
      </label>
      {/*
        The report text itself is written for the NCMEC analyst who receives it,
        not for the person copying it: it carries the image fingerprint, the
        versions that scored the conversation and which messages a person read,
        because an investigator needs those to act. data-technical keeps the
        plain language test off this one box and nothing around it.
      */}
      <textarea
        data-technical
        id={`draft-${pairId}`}
        className={styles.draft}
        readOnly
        value={text}
        spellCheck={false}
      />

      <div className={styles.draftActions}>
        <Button variant="secondary" loading={busy === "copy"} onClick={() => void copy()}>
          Copy Report
        </Button>
        <Button variant="secondary" loading={busy === "download"} onClick={() => void download()}>
          Download
        </Button>
        <a className={styles.linkAction} href={CYBERTIPLINE_URL} rel="noreferrer noopener" target="_blank">
          Open NCMEC&apos;s Report Form
        </a>
      </div>

      {status ? (
        <p className={styles.note} role="status">
          {status}
        </p>
      ) : null}

      <ol className={styles.steps}>
        <li>Open NCMEC&apos;s report form.</li>
        <li>Copy each section into the matching box. Don&apos;t change the messages.</li>
        <li>Keep the original messages on your server. Don&apos;t edit or delete them.</li>
        <li>Don&apos;t contact either account about this.</li>
      </ol>

      <p className={styles.note}>
        Guardian never has images, so there&apos;s nothing to attach. NCMEC: 1-800-843-5678.
      </p>
    </Card>
  );
}
