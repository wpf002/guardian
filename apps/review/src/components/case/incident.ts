/**
 * The CyberTipline incident type, as a reviewer chooses it.
 *
 * NCMEC takes one incidentType per report and routes and prioritises on it.
 * packages/report derives one from the recorded signals where it can, and marks
 * the fallback as a fallback so the completeness scorer blocks a report
 * categorised by a default. Three of the eight types are reachable from
 * signals; the other five describe things Guardian's detectors do not and
 * should not assert, and a person is the only way to reach them.
 *
 * This module is the console's side of that: the eight options, the derived
 * default for a case, and one sentence per option in the words a reviewer would
 * use. The wire values are never reworded, because they go on a report.
 */

import { NCMEC_INCIDENT_TYPES, signalsToIncidentType, type NcmecIncidentType } from "@guardian/report";
import { isMinorBand } from "@guardian/schema";
import type { CaseDetail, TimelineState } from "@/lib/data/types";
import { buildSignalList } from "./signals";

export { NCMEC_INCIDENT_TYPES };
export type { NcmecIncidentType };

/** Where the type on a draft came from. Printed on the draft itself. */
export type IncidentTypeSource = "signals" | "reviewer" | "default";

export interface IncidentChoice {
  incidentType: NcmecIncidentType;
  source: IncidentTypeSource;
  /** Signal names behind a derived type. Empty for a fallback or a choice. */
  drivenBy: string[];
}

/**
 * What the signals on this case derive, before a reviewer touches it.
 *
 * The media verdict is passed through rather than inferred: only a verdict the
 * operator's own scanner established can reach the CSAM incident type, and
 * Guardian never opens a file and never forms that view itself (rule 1).
 */
export function derivedIncident(detail: CaseDetail, timeline: TimelineState): IncidentChoice {
  const rows = timeline.state === "ready" ? timeline.rows : [];
  const result = signalsToIncidentType({
    signals: buildSignalList(detail, timeline).map((signal) => signal.kind),
    knownCsamVerdicts: rows.map((row) => row.media?.verdict ?? null),
    minorToMinor:
      isMinorBand(detail.queue.actorBand.band) && isMinorBand(detail.queue.targetBand.band),
  });
  return {
    incidentType: result.incidentType,
    source: result.derived ? "signals" : "default",
    drivenBy: result.derived ? Array.from(new Set(result.drivenBy)) : [],
  };
}

/** What a reviewer picking one of the eight is choosing, in plain words. */
export const INCIDENT_TYPE_NOTES: Record<NcmecIncidentType, string> = {
  "Child Pornography (possession, manufacture, and distribution)":
    "Only where your own scanner established a match. Guardian never opened a file and cannot support this on its own.",
  "Child Sex Trafficking": "Something of value offered or exchanged, with the conversation moving toward a meeting.",
  "Child Sex Tourism": "Travel arranged or discussed for the purpose of sexual contact with a child.",
  "Child Sexual Molestation": "Contact offending described in the conversation, rather than solicited in it.",
  "Misleading Domain Name": "A domain built to route a child to sexual material.",
  "Misleading Words or Digital Images on the Internet":
    "Listings or words built to route a child to sexual material.",
  "Online Enticement of Children for Sexual Acts":
    "Solicitation of a child over a service. Sextortion is reported here, with the sextortion annotation set.",
  "Unsolicited Obscene Material Sent to a Child": "Sexual material sent to a child who did not ask for it.",
};

/**
 * One line for the draft saying where the type came from. A report categorised
 * by a fallback has to say so somewhere the filer can see it, because NCMEC
 * routes on the field and nothing downstream distinguishes a default from a
 * finding.
 */
export function incidentSourceLine(choice: IncidentChoice): string {
  switch (choice.source) {
    case "signals":
      return `derived from the recorded signals (${choice.drivenBy.join(", ")})`;
    case "reviewer":
      return "chosen by the reviewer";
    default:
      return "a fallback. No recorded signal maps to a type and no reviewer chose one. Choose one before filing";
  }
}
