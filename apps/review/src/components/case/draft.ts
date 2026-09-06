/**
 * The drafted report bundle, as plain text.
 *
 * Guardian drafts. It never submits. There is no CyberTipline client on this
 * path and no button anywhere in this app that sends anything to anybody: the
 * operator is the reporter of record and files at report.cybertip.org
 * themselves (DESIGN-UI 8.6).
 *
 * The draft carries verbatim excerpts where the bundle holds them, because
 * nothing softened is ever persisted or exported, and it says plainly which
 * excerpts a person read and which nobody did. A thinner honest bundle survives
 * a suppression motion where a fuller coerced one does not.
 */

import { bandWord } from "@/lib/mock/fixtures";
import type { CaseDetail, TimelineState } from "@/lib/data/types";
import { derivedIncident } from "./incident";
import { incidentSourceLine, type IncidentChoice } from "./incident-types";
import { buildSignalList } from "./signals";

export { CYBERTIPLINE_URL } from "./cybertipline";
import { CYBERTIPLINE_URL } from "./cybertipline";

export interface ReportDraftInput {
  detail: CaseDetail;
  timeline: TimelineState;
  reviewerName: string;
  jurisdiction: string | null;
  generatedAt: Date;
  /**
   * The CyberTipline incident type and where it came from. NCMEC routes and
   * prioritises on this field and takes exactly one per report, so the draft
   * names it and says whether a person chose it. Omitted, the draft derives it
   * from the recorded signals, which is what the report builder does too.
   */
  incident?: IncidentChoice;
}

function line(label: string, value: string): string {
  return `${label.padEnd(22, " ")}${value}`;
}

function stamp(at: Date): string {
  return at.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export function buildReportDraft(input: ReportDraftInput): string {
  const { detail, timeline, reviewerName, jurisdiction, generatedAt } = input;
  const incident = input.incident ?? derivedIncident(detail, timeline);
  const q = detail.queue;
  const signals = buildSignalList(detail, timeline);
  const rows = timeline.state === "ready" ? timeline.rows : [];
  const excerpts = rows.filter((row) => row.media === null);
  const media = rows.filter((row) => row.media !== null);
  const readCount = excerpts.filter((row) => row.viewedByHuman).length;

  const out: string[] = [];
  out.push("GUARDIAN EVIDENCE BUNDLE, DRAFTED FOR CYBERTIPLINE FILING");
  out.push("");
  out.push(
    "This is a draft. Guardian has not submitted anything. The operator is the reporter of record and files it at " +
      CYBERTIPLINE_URL +
      ".",
  );
  out.push("");
  out.push("REPORT SUBJECT");
  out.push(line("Pair", q.pairId));
  out.push(line("Customer", `${q.customerName} (${q.customerId})`));
  out.push(line("Channel", q.channel ?? "not recorded"));
  out.push(line("Jurisdiction", jurisdiction ?? "not recorded"));
  out.push(line("Tier", q.tier));
  out.push(line("Incident type", incident.incidentType));
  out.push(line("  how it was set", incidentSourceLine(incident)));
  out.push(
    line(
      "Critical signals",
      q.criticalSignals.length > 0 ? q.criticalSignals.join(", ") : "none",
    ),
  );
  out.push("");
  out.push("THE TWO ACCOUNTS");
  // Neutrally labelled, and both ids printed. The draft used to name one of
  // them "Older-band account" and print only "Hashed actor id", which made
  // Guardian's own choice about which side the detectors scored read as a
  // designation. The CyberTipline form asks the filer who the report is about;
  // that is their answer to give, not Guardian's (CLAUDE.md rule 5).
  const subject = detail.reportedSubjectUid;
  const label = (uid: string, fallback: string): string =>
    subject === null ? fallback : uid === subject ? `${fallback} (you named this one)` : fallback;

  out.push(
    line(
      label(detail.accounts.actorUid, "First account"),
      `${bandWord(q.actorBand.band)} band, provenance ${q.actorBand.provenance}, confidence ${
        q.actorBand.confidence === null ? "not published" : q.actorBand.confidence.toFixed(2)
      }`,
    ),
  );
  out.push(line("  hashed id", detail.accounts.actorUid));
  out.push(
    line(
      label(detail.accounts.targetUid, "Second account"),
      `${bandWord(q.targetBand.band)} band, provenance ${q.targetBand.provenance}, confidence ${
        q.targetBand.confidence === null ? "not published" : q.targetBand.confidence.toFixed(2)
      }`,
    ),
  );
  out.push(line("  hashed id", detail.accounts.targetUid));
  out.push("");
  out.push(
    subject === null
      ? "WHO THIS REPORT IS ABOUT: not yet decided. Guardian does not decide it. The CyberTipline asks who is being reported, and the answer is yours to give from the conversation below, not from which account Guardian scored. Note that Guardian's detectors fire on accounts in a younger band on purpose, so the account it scored is sometimes the child."
      : `WHO THIS REPORT IS ABOUT: the account marked above. You designated it; Guardian did not.`,
  );
  out.push("Guardian stores age bands and never birthdates, and hashes ids per customer.");
  out.push("");
  out.push("WHAT WAS RECORDED");
  out.push(detail.whySentence);
  out.push("");
  for (const signal of signals) {
    out.push(
      `- ${signal.label}${signal.critical ? " (critical)" : ""}, ${signal.occurrences} occurrence(s)`,
    );
    for (const entry of signal.lexicon) {
      out.push(
        `    normalized "${entry.original}" to "${entry.normalized}", lexicon ${entry.lexiconVersion}, entry ${entry.entry}`,
      );
    }
  }
  out.push("");
  out.push("STAGE PATH");
  if (detail.stagePath.length === 0) {
    out.push("No stage was reached in this window.");
  } else {
    for (const point of detail.stagePath) {
      out.push(
        `- ${point.stage} at ${point.reachedAt ? stamp(point.reachedAt) : "time not recorded"}${
          point.elapsedHoursFromPrevious === null
            ? ""
            : `, ${point.elapsedHoursFromPrevious}h after the previous stage`
        }`,
      );
    }
  }
  out.push("");
  out.push("EXCERPTS, VERBATIM");
  if (excerpts.length === 0) {
    out.push("No excerpts are attached to this case.");
  }
  for (const row of excerpts) {
    // Where it was said. A line in an open channel and the same line in a DM
    // are different facts on a filing, and Regulation (EU) 2026/1881 treats
    // the two differently. An unstated visibility is reported as unstated
    // rather than assumed either way (ROADMAP P-9).
    const where =
      row.channelVisibility === null
        ? " channel visibility not stated"
        : ` ${row.channelVisibility} channel`;
    const head = `[${row.speaker}] ${stamp(row.at)} ${row.bandLabel}${where}`;
    const stage =
      row.stage && row.confidence !== null
        ? `  stage ${row.stage}, confidence ${row.confidence.toFixed(2)}`
        : row.stage
          ? `  stage ${row.stage}`
          : "";
    out.push(head + stage);
    if (row.text) {
      out.push(`    ${row.text}`);
    } else if (row.collapsed) {
      out.push(
        `    [${row.collapsed.spanClass}, ${row.collapsed.wordCount} words. The bundle holds this excerpt verbatim; this draft was generated without it loaded.]`,
      );
    }
    out.push(
      `    recorded as read by a person at Guardian in the review console: ${
        row.viewedByHuman ? "yes" : "no"
      }`,
    );
  }
  out.push("");
  out.push("MEDIA EVENTS");
  if (media.length === 0) {
    out.push("None recorded.");
  }
  for (const row of media) {
    const event = row.media!;
    out.push(`- ${stamp(row.at)}, ${event.direction.replace(/_/g, " ")}`);
    out.push(`    sha256:${event.sha256}`);
    out.push(`    operator verdict: ${event.verdict.replace(/_/g, " ")}`);
    out.push(
      `    viewed by a person at the operator: ${event.viewedByOperatorHuman ? "yes" : "no"}`,
    );
    out.push("    Guardian holds no image. Only the hash was ever received.");
  }
  out.push("");
  out.push("COMPLETENESS");
  out.push(
    line(
      "Excerpts",
      `${excerpts.length} present, ${readCount} recorded as read by a person at Guardian, ${
        excerpts.length - readCount
      } recorded as read by nobody`,
    ),
  );
  out.push(
    line(
      "Read record",
      "written by the review console when an excerpt was rendered to a named reviewer, and appended to the hash-chained audit log as an evidence.read entry with the reviewer, the timestamp and the excerpts it covered",
    ),
  );
  out.push(line("Timestamps", "present, with timezone"));
  out.push(line("Versions", `model ${detail.versions.modelVersion}, lexicon ${detail.versions.lexiconVersion}, fusion ${detail.versions.fusionVersion}`));
  out.push(line("Audit chain", detail.auditSeq === null ? "not recorded" : `entry ${detail.auditSeq}`));
  out.push(line("Prepared by", reviewerName));
  out.push(line("Prepared at", stamp(generatedAt)));
  out.push("");
  out.push("HOW TO FILE");
  out.push(`1. Open ${CYBERTIPLINE_URL} and start an Electronic Service Provider or public report.`);
  out.push("2. Paste the sections above into the matching fields. Do not alter the excerpts.");
  out.push("3. Preserve the original records on your own service. Do not delete or edit them.");
  out.push("4. Do not contact either account about this report.");
  out.push("5. NCMEC 1-800-843-5678. Know2Protect 1-833-591-5669.");
  out.push("");
  out.push(
    "Guardian assigns tiers and assembles evidence for human review. It does not decide what a person is, and this draft does not either.",
  );
  return out.join("\n");
}
