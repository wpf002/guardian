import { randomUUID } from "node:crypto";
import type {
  BandClaim,
  ChannelVisibility,
  EvidenceBundle,
  EvidenceTimelineRow,
  Jurisdiction,
  LegalBasis,
  Provenance,
  ReportCompleteness,
  ReportField,
  ReportFieldCompleteness,
  ReportFilingMode,
  ReporterOfRecord,
  RetentionClass,
  ReviewerContext,
  SignalHit,
  SignalKind,
  Stage,
  Surface,
  Tier,
  Versions,
} from "@guardian/schema";
import { retentionForTier } from "@guardian/schema";

/**
 * Evidence bundle (DESIGN.md 7, 8). Text excerpts, hashes, timestamps and model
 * versions. No imagery, ever: the reviewer never sees an image and Guardian
 * never holds one. The bundle anchors to the audit chain head so the export can
 * be shown to have preceded any later edit.
 *
 * The shape is a superset of what a CyberTipline report needs, so building the
 * report is a projection rather than a re-entry (RESEARCH.md gap A6). Stanford
 * found reports fail on completeness rather than on detection, and NCMEC's 2025
 * numbers say over a tenth of industry reports lacked enough data to determine
 * jurisdiction. Each field added for that reason names its consumer where it is
 * declared in packages/schema.
 *
 * Two things this module does not do. It never decides that a report may be
 * filed: that turns on a reviewer-confirmed T3, which only
 * apps/review/src/lib/decisions.ts can produce (rule 6), and the bundle records
 * the decision rather than making one. And it never characterises a person
 * (rule 5); every string here describes traffic, a field or a gap.
 */

/**
 * A band claim as a caller states it. Provenance defaults to unknown, which is
 * the honest answer for a surface that did not say, and a confidence nobody
 * published stays null rather than becoming a zero a reader could take for low.
 */
export interface BandClaimInput {
  band: BandClaim["band"];
  confidence?: number | null;
  provenance?: BandClaim["provenance"];
}

function bandClaim(input: BandClaimInput | null | undefined): BandClaim | null {
  if (!input) return null;
  return {
    band: input.band,
    confidence: input.confidence ?? null,
    provenance: input.provenance ?? "unknown",
  };
}

export interface TimelineInput {
  ts: Date;
  channel: string;
  direction: "actor_to_target" | "target_to_actor";
  text: string | null;
  mediaSha256: string | null;
  knownCsamVerdict: "match" | "no_match" | "not_run" | null;
  stage: Stage | null;
  signals: SignalKind[];
  /** Which surface this one event arrived on. */
  surface?: Surface | null;
  /** Public, private or group, as the customer stated it. Null means unstated. */
  channelVisibility?: ChannelVisibility | null;
  /** Bands as claimed at event time, with confidence and provenance. */
  actorAge?: BandClaimInput | null;
  targetAge?: BandClaimInput | null;
  /**
   * Whether a person actually read this excerpt. Honored only when the caller
   * also supplies reviewer context: a bundle with no reviewer behind it cannot
   * claim anybody read anything, and the kernel writes false.
   */
  viewedByHuman?: boolean;
}

/** The customer's identity as the reporter of record, as far as Guardian holds it. */
export interface ReporterInput {
  providerName?: string | null;
  espId?: string | null;
  filingMode?: ReportFilingMode;
  contactOnFile?: boolean;
}

export interface BuildBundleInput {
  customerId: string;
  actorUid: string;
  targetUid: string;
  tier: Tier;
  timeline: TimelineInput[];
  signals: SignalHit[];
  versions: Versions;
  provenance: Provenance[];
  auditHead: string;
  now?: Date;
  /** Excerpt cap per message. Enough for context, not a transcript dump. */
  maxExcerpt?: number;
  retention?: RetentionClass;
  /** Copied from the customer record at generation time, not joined later. */
  jurisdiction?: Jurisdiction | null;
  legalBasis?: LegalBasis | null;
  /** IANA zone from the customer record. Absent falls back to UTC and says so. */
  timezone?: string | null;
  reporter?: ReporterInput;
  /** The reviewer decision behind this bundle. Absent on a kernel-generated one. */
  reviewer?: ReviewerContext | null;
}

export function buildEvidenceBundle(input: BuildBundleInput): EvidenceBundle {
  const maxExcerpt = input.maxExcerpt ?? 500;
  const generatedAt = input.now ?? new Date();
  const zone = resolveZone(input.timezone);
  const reviewer = input.reviewer ?? null;

  const timeline: EvidenceTimelineRow[] = [...input.timeline]
    .sort((a, b) => a.ts.getTime() - b.ts.getTime())
    .map((row) => ({
      ts: row.ts,
      channel: row.channel,
      direction: row.direction,
      excerpt: row.text === null ? null : row.text.slice(0, maxExcerpt),
      mediaSha256: row.mediaSha256,
      knownCsamVerdict: row.knownCsamVerdict,
      stage: row.stage,
      signals: row.signals,
      // A bundle the kernel just generated has been read by nobody. Only a
      // reviewer action in apps/review may flip this to true, so the flag is
      // taken from the caller only where a reviewer decision came with it.
      viewedByHuman: reviewer === null ? false : (row.viewedByHuman ?? false),
      channelVisibility: row.channelVisibility ?? null,
      tsLocal: localIso(row.ts, zone.timezone),
      tsOffsetMinutes: offsetMinutes(row.ts, zone.timezone),
      surface: row.surface ?? null,
      actorAge: bandClaim(row.actorAge),
      targetAge: bandClaim(row.targetAge),
    }));

  const reporter: ReporterOfRecord = {
    // The customer is the 2258A provider and the reporter of record. Guardian
    // is their agent and never files on its own account (DESIGN.md 9.2).
    customerId: input.customerId,
    providerName: input.reporter?.providerName ?? null,
    espId: input.reporter?.espId ?? null,
    filingMode: input.reporter?.filingMode ?? "customer_direct",
    contactOnFile: input.reporter?.contactOnFile ?? false,
  };

  const bundle: EvidenceBundle = {
    bundleId: `bdl_${randomUUID()}`,
    customerId: input.customerId,
    actorUid: input.actorUid,
    targetUid: input.targetUid,
    tier: input.tier,
    timeline,
    signals: input.signals,
    versions: input.versions,
    provenance: dedupeProvenance(input.provenance),
    jurisdiction: input.jurisdiction ?? null,
    legalBasis: input.legalBasis ?? null,
    reporter,
    timezone: zone.timezone,
    timezoneSource: zone.source,
    generatedAt,
    generatedAtLocal: localIso(generatedAt, zone.timezone),
    generatedAtOffsetMinutes: offsetMinutes(generatedAt, zone.timezone),
    reviewer: reviewer === null ? null : withLocalDecisionTime(reviewer, zone.timezone),
    completeness: { fields: [], missing: [], complete: false },
    retention: input.retention ?? retentionForTier(input.tier),
    auditHead: input.auditHead,
  };

  bundle.completeness = assessCompleteness(bundle);
  return bundle;
}

function dedupeProvenance(items: Provenance[]): Provenance[] {
  const seen = new Set<string>();
  const out: Provenance[] = [];
  for (const p of items) {
    const key = `${p.surface}:${p.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function withLocalDecisionTime(reviewer: ReviewerContext, timeZone: string): ReviewerContext {
  return {
    ...reviewer,
    decidedAtLocal: localIso(reviewer.decidedAt, timeZone),
    decidedAtOffsetMinutes: offsetMinutes(reviewer.decidedAt, timeZone),
  };
}

/* -------------------------------------------------------------------------- */
/* Timezone                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The report asks for local time. A UTC instant on its own does not answer it,
 * and an offset applied when the report is filed gets the wrong answer for
 * anything on the other side of a daylight-saving boundary, so the offset is
 * computed per instant from the zone that was in force at that instant.
 */
export function resolveZone(timezone: string | null | undefined): {
  timezone: string;
  source: "customer" | "default_utc";
} {
  if (!timezone) return { timezone: "UTC", source: "default_utc" };
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
    return { timezone, source: "customer" };
  } catch {
    // An unusable zone falls back rather than throwing. A bundle that renders
    // in UTC and says so is better than an export that dies at generation.
    return { timezone: "UTC", source: "default_utc" };
  }
}

interface ZoneParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

function zoneParts(at: Date, timeZone: string): ZoneParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, string> = {};
  for (const part of dtf.formatToParts(at)) {
    if (part.type !== "literal") out[part.type] = part.value;
  }
  // Some ICU builds render midnight as hour 24 in this locale.
  const hour = out.hour === "24" ? "00" : (out.hour ?? "00");
  return {
    year: (out.year ?? "0000").padStart(4, "0"),
    month: out.month ?? "01",
    day: out.day ?? "01",
    hour,
    minute: out.minute ?? "00",
    second: out.second ?? "00",
  };
}

/** Minutes east of UTC in `timeZone` at `at`. Negative west of it. */
export function offsetMinutes(at: Date, timeZone: string): number {
  const p = zoneParts(at, timeZone);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** ISO 8601 local time with the offset in force, such as 2026-09-02T08:05:00-04:00. */
export function localIso(at: Date, timeZone: string): string {
  const p = zoneParts(at, timeZone);
  const offset = offsetMinutes(at, timeZone);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${hh}:${mm}`;
}

/* -------------------------------------------------------------------------- */
/* Completeness                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Which report-required fields this bundle can fill and which it cannot,
 * computed while the bundle is built so a reviewer sees the gap before filing
 * rather than after. NCMEC named the jurisdiction gap in 2025 and now names the
 * companies behind it, so the gap is a product surface, not a footnote.
 */
export function assessCompleteness(
  bundle: Omit<EvidenceBundle, "completeness">,
): ReportCompleteness {
  const rows = bundle.timeline;
  const mediaRows = rows.filter((r) => r.mediaSha256 !== null);
  const bands = rows.map((r) => r.targetAge).filter((b): b is BandClaim => b != null);
  const reviewer = bundle.reviewer ?? null;
  const narrative = [
    reviewer?.notes?.timeline,
    reviewer?.notes?.outsideContext,
    reviewer?.notes?.recommendation,
  ].some((n) => (n ?? "").trim().length > 0);

  const fields: ReportFieldCompleteness[] = [
    field(
      "reporter_identity",
      bundle.reporter.providerName != null && bundle.reporter.providerName.trim() !== "",
      "The provider name as registered with NCMEC is not on the customer record.",
      bundle.reporter.filingMode === "guardian_as_agent"
        ? "Filed by Guardian as the customer's agent."
        : "The customer files directly.",
    ),
    field(
      "reporter_contact",
      bundle.reporter.contactOnFile,
      "No named point of contact is on file. Guardian holds the flag, not the contact details.",
    ),
    field(
      "reporter_jurisdiction",
      bundle.jurisdiction != null,
      "The customer record states no jurisdiction, which is the field over a tenth of 2025 industry reports could not answer.",
    ),
    field(
      "legal_basis",
      bundle.legalBasis != null,
      "The customer record states no legal basis for processing this traffic.",
    ),
    field(
      "incident_timezone",
      bundle.timezoneSource === "customer",
      "Rendered in UTC because the customer record states no timezone. Local times in this bundle are UTC, not the operator's clock.",
    ),
    field("incident_time_range", rows.length > 0, "This bundle retains no timestamped rows."),
    field(
      "reported_account_identifier",
      bundle.actorUid.trim() !== "",
      "No identifier for the sending account.",
      "Salted-hashed per customer (rule 8). The customer maps it back to their own account id before filing.",
    ),
    // Always empty, and deliberately listed. The IP capture event is what
    // makes a report routable, and its absence is most of the reason a tenth
    // of 2025 industry reports could not be routed at all. Guardian does not
    // capture IPs, so the gap is stated here rather than discovered at filing.
    field(
      "reported_account_ip_capture",
      false,
      "Guardian captures no IP addresses. The customer holds them and supplies them at filing, and without one the report may not route to a jurisdiction.",
    ),
    field(
      "child_account_identifier",
      bundle.targetUid.trim() !== "",
      "No identifier for the receiving account.",
      "Salted-hashed per customer (rule 8). The customer maps it back to their own account id before filing.",
    ),
    field(
      "child_age_band",
      bands.length > 0,
      "No age band was stated for the receiving account on any event in this window.",
      bands.length > 0 && bands.every((b) => b.provenance === "unknown")
        ? "Every band in this window has provenance unknown, which does not meet a highly effective age assurance test."
        : null,
    ),
    field(
      "chat_excerpts",
      rows.some((r) => r.excerpt !== null),
      "Retention for this tier kept no text, so the bundle carries timestamps and features only.",
    ),
    mediaRows.length === 0
      ? notApplicable("media_hash", "No media event in this window.")
      : field("media_hash", true, "", "Hashes only. Guardian never holds bytes (rule 1)."),
    mediaRows.length === 0
      ? notApplicable("media_scanner_verdict", "No media event in this window.")
      : field(
          "media_scanner_verdict",
          mediaRows.some((r) => r.knownCsamVerdict === "match" || r.knownCsamVerdict === "no_match"),
          "The operator's own scanner verdict was not recorded. Guardian never opens media and cannot supply it.",
        ),
    field(
      "human_review_confirmation",
      reviewer !== null && reviewer.resultTier === "T3",
      reviewer === null
        ? "No reviewer decision is attached. A report may be built only from a reviewer-confirmed T3 (rule 6)."
        : `The reviewer decision on this bundle produced tier ${reviewer.resultTier}, not T3.`,
      reviewer?.viewedExcerptCount != null
        ? `Excerpts the reviewer marked as read: ${reviewer.viewedExcerptCount}.`
        : null,
    ),
    field(
      "reviewer_narrative",
      narrative,
      reviewer === null
        ? "No reviewer decision is attached, so there is nothing a person wrote."
        : "The reviewer recorded no notes on this decision.",
    ),
    field("audit_chain_anchor", bundle.auditHead.trim() !== "", "No audit chain head was recorded."),
    field(
      "model_versions",
      [
        bundle.versions.modelVersion,
        bundle.versions.lexiconVersion,
        bundle.versions.fusionVersion,
      ].every((v) => v.trim() !== ""),
      "One or more of the version triple is unset.",
    ),
  ];

  const missing = fields.filter((f) => f.status === "empty").map((f) => f.field);
  return { fields, missing, complete: missing.length === 0 };
}

/**
 * One completeness row. `whenEmpty` says what is missing and is used only when
 * the field is not filled; `whenFilled` is optional context the filer needs
 * even when the answer is there, such as the fact that a uid is a per-customer
 * hash rather than the customer's own id.
 */
function field(
  name: ReportField,
  filled: boolean,
  whenEmpty: string,
  whenFilled: string | null = null,
): ReportFieldCompleteness {
  return {
    field: name,
    status: filled ? "filled" : "empty",
    note: filled ? whenFilled : whenEmpty,
  };
}

function notApplicable(name: ReportField, note: string): ReportFieldCompleteness {
  return { field: name, status: "not_applicable", note };
}

/**
 * Human-readable summary for a mod channel or a reviewer card. Describes what
 * happened in the traffic and never characterises the person
 * (CLAUDE.md rule 5).
 */
export function summarizeBundle(bundle: EvidenceBundle, rationale: string[]): string {
  const first = bundle.timeline[0];
  const last = bundle.timeline[bundle.timeline.length - 1];
  const window =
    first && last
      ? `${first.tsLocal ?? first.ts.toISOString()} to ${last.tsLocal ?? last.ts.toISOString()} (${bundle.timezone})`
      : "no messages retained";
  const lines = [
    `Tier ${bundle.tier} on one conversation pair.`,
    `Window: ${window}.`,
    `Messages in bundle: ${bundle.timeline.length}. Signals recorded: ${bundle.signals.length}.`,
    ...rationale.map((r) => `- ${r}`),
    bundle.completeness.complete
      ? "Report fields: all filled."
      : `Report fields still unfilled: ${bundle.completeness.missing.join(", ")}.`,
    "This is a risk tier for human review, not a determination about any person.",
  ];
  return lines.join("\n");
}
