"use client";

import { useState } from "react";
import { Button, Card } from "@/components";
import { CYBERTIPLINE_URL } from "./cybertipline";
import { filingHeadline, type FilingReadiness } from "./filing";
import {
  INCIDENT_TYPE_NOTES,
  NCMEC_INCIDENT_TYPES,
  type NcmecIncidentType,
} from "./incident";
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
  onExport,
  onIncidentType,
}: ReportDraftProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<"copy" | "download" | null>(null);
  const [incidentType, setIncidentType] = useState<NcmecIncidentType>(derivedIncidentType);
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
        "The draft could not be rebuilt under that incident type. Reload the case before filing, so the type on the text matches the one you chose.",
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
          "This browser did not offer a clipboard. Select the text in the box and copy it yourself.",
        );
        return;
      }
      await navigator.clipboard.writeText(text);
      await onExport(pairId, "copy");
      setStatus("Copied, and the export is on the audit chain.");
    } catch {
      setStatus("The copy did not complete. Select the text in the box and copy it yourself.");
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
      setStatus("Saved, and the export is on the audit chain.");
    } catch {
      setStatus("The file was not saved. Select the text in the box and copy it instead.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      title="Report draft, for filing at the CyberTipline"
      aside="owner only"
      density="padded"
    >
      <p className={styles.note}>
        Guardian drafts this. Guardian does not submit it, and nothing on this screen sends
        anything anywhere. You are the reporter of record, and you file it at{" "}
        <a href={CYBERTIPLINE_URL} rel="noreferrer noopener" target="_blank">
          report.cybertip.org
        </a>
        . This goes to NCMEC, not to the police.
      </p>

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
        <p className={styles.note}>
          This is the report side: what a recipient needs to route and act on the filing. The
          evidence record keeps its own completeness score, which travels inside the bundle and the
          audit export rather than on this card.
        </p>
      </div>

      <div className={styles.incident}>
        <label htmlFor={`incident-${pairId}`}>Incident type on this report</label>
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
            ? "Chosen by you. The draft says so, because NCMEC routes on this field and a reader has to be able to tell a choice from a derivation."
            : incidentTypeDerived
              ? "Derived from the recorded signals. Change it if the conversation shows something the signals did not name."
              : "A fallback. No recorded signal maps to a type, so this one has nothing behind it. Choose the type this conversation actually shows before you file."}
        </p>
      </div>

      <label className="sr-only" htmlFor={`draft-${pairId}`}>
        Drafted report text
      </label>
      <textarea
        id={`draft-${pairId}`}
        className={styles.draft}
        readOnly
        value={text}
        spellCheck={false}
      />

      <div className={styles.draftActions}>
        <Button variant="secondary" loading={busy === "copy"} onClick={() => void copy()}>
          Copy the text
        </Button>
        <Button variant="secondary" loading={busy === "download"} onClick={() => void download()}>
          Download as .txt
        </Button>
        <a className={styles.linkAction} href={CYBERTIPLINE_URL} rel="noreferrer noopener" target="_blank">
          Open report.cybertip.org
        </a>
      </div>

      {status ? (
        <p className={styles.note} role="status">
          {status}
        </p>
      ) : null}

      <ol className={styles.steps}>
        <li>Open the CyberTipline and start a report as the provider.</li>
        <li>Paste each section into the matching field. Do not alter the excerpts.</li>
        <li>Preserve the original records on your own service. Do not edit or delete them.</li>
        <li>Do not contact either account about this report.</li>
        <li>
          Keep the audit chain reference. It is what makes this bundle survive a challenge
          later.
        </li>
      </ol>

      <p className={styles.note}>
        There is no way to attach an image here, because Guardian never received one. NCMEC
        1-800-843-5678. Know2Protect 1-833-591-5669.
      </p>
    </Card>
  );
}
