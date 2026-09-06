/**
 * Deriving the CyberTipline incident type from a case.
 *
 * Server side only: signalsToIncidentType lives in @guardian/report, which
 * reaches the lexicon and the filesystem through the schema barrel. The eight
 * types, their notes and the source line are in incident-types.ts, which is
 * client safe and is what the selector imports.
 *
 * NCMEC takes one incidentType per report and routes and prioritises on it.
 * Three of the eight are reachable from Guardian's signals; the other five
 * describe things its detectors do not and should not assert, so a person is
 * the only way to reach them.
 */

import { signalsToIncidentType } from "@guardian/report";
import { isMinorBand } from "@guardian/schema";
import type { CaseDetail, TimelineState } from "@/lib/data/types";
import { buildSignalList } from "./signals";
import type { IncidentChoice } from "./incident-types";

export * from "./incident-types";

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
