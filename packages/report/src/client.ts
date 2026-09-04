/**
 * CyberTipline ESP API client.
 *
 * Endpoints, base URLs and the auth scheme are read off the public technical
 * documentation at https://report.cybertip.org/ispws/documentation:
 *
 *   GET  /status    verify connectivity and credentials
 *   GET  /xsd       fetch the authoritative schema
 *   POST /submit    open a report, body is one XML document
 *   POST /upload    attach file bytes, multipart
 *   POST /fileinfo  describe an uploaded file
 *   POST /finish    complete the report, form parameter id
 *   POST /retract   cancel an unfinished report, form parameter id
 *
 * Production is https://report.cybertip.org/ispws and test is
 * https://exttest.cybertip.org/ispws. Authentication is HTTP basic with a
 * username and password issued by NCMEC on request; there is no self-service
 * registration, and each ESP holds its own account. Guardian files as the
 * customer's agent on the customer's credentials and never on an account of
 * its own, so the credentials here are always a customer's.
 *
 * Two things this client will not do.
 *
 * It has no upload(). The /upload endpoint takes file bytes and Guardian never
 * possesses image or video bytes (CLAUDE.md rule 1), so the method does not
 * exist rather than existing and throwing. A report Guardian submits names each
 * file by hash in the narrative; if the operator wants bytes in the report they
 * upload them from their own systems.
 *
 * It cannot be constructed against production by accident. The environment
 * comes from an explicit argument or from NCMEC_API_ENV set to the literal
 * string "production", and anything else, including an unset variable, a typo
 * or an empty string, is the test environment. There is no default that reaches
 * a real report.
 *
 * Every request goes through an injectable fetch, so no test in this package
 * makes a network call.
 */

import {
  reportDoneResponseSchema,
  reportResponseSchema,
  type CyberTiplineReport,
  type ReportDoneResponse,
  type ReportResponse,
} from "./schema.js";

export const ESP_BASE_URLS = {
  test: "https://exttest.cybertip.org/ispws",
  production: "https://report.cybertip.org/ispws",
} as const;

export type EspEnvironment = keyof typeof ESP_BASE_URLS;

/** The subset of fetch this client uses, so a test can supply a plain function. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export interface EspCredentials {
  username: string;
  password: string;
}

export interface EspClientOptions {
  /**
   * Which environment to talk to. Omit and the client reads NCMEC_API_ENV,
   * which has to equal "production" exactly to reach production. Anything else
   * is test.
   */
  environment?: EspEnvironment;
  credentials?: EspCredentials;
  /** Injected in tests. Defaults to global fetch. */
  fetchImpl?: FetchLike;
  /** Which customer these credentials belong to, for the audit trail. */
  customerId?: string;
  timeoutMs?: number;
}

export class EspClientError extends Error {
  constructor(
    readonly code:
      | "missing_credentials"
      | "no_fetch"
      | "production_not_explicit"
      | "customer_mismatch"
      | "http_error"
      | "unparseable_response"
      | "refused_media_upload",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "EspClientError";
  }
}

/**
 * Resolve the environment. The only way to production is an explicit argument
 * or NCMEC_API_ENV set to exactly "production". This is a function rather than
 * inline logic so the rule has one place and one test.
 */
export function resolveEnvironment(
  explicit: EspEnvironment | undefined,
  env: Record<string, string | undefined> = process.env,
): EspEnvironment {
  if (explicit === "production") return "production";
  if (explicit === "test") return "test";
  return env.NCMEC_API_ENV === "production" ? "production" : "test";
}

export class EspClient {
  readonly environment: EspEnvironment;
  readonly baseUrl: string;
  readonly customerId: string | undefined;

  private readonly credentials: EspCredentials;
  private readonly fetchImpl: FetchLike;

  constructor(options: EspClientOptions = {}, env: Record<string, string | undefined> = process.env) {
    this.environment = resolveEnvironment(options.environment, env);
    this.baseUrl = ESP_BASE_URLS[this.environment];
    this.customerId = options.customerId;

    const username = options.credentials?.username ?? env.NCMEC_API_USER;
    const password = options.credentials?.password ?? env.NCMEC_API_PASS;
    if (!username || !password) {
      throw new EspClientError(
        "missing_credentials",
        "No CyberTipline credentials. Set NCMEC_API_USER and NCMEC_API_PASS, or pass credentials. These belong to the reporting provider, not to Guardian: NCMEC issues them per ESP on request and Guardian files as the provider's agent.",
      );
    }
    this.credentials = { username, password };

    const injected = options.fetchImpl;
    if (injected) {
      this.fetchImpl = injected;
    } else {
      const globalFetch = (globalThis as { fetch?: unknown }).fetch;
      if (typeof globalFetch !== "function") {
        throw new EspClientError(
          "no_fetch",
          "No fetch implementation available in this runtime. Pass fetchImpl.",
        );
      }
      this.fetchImpl = globalFetch as FetchLike;
    }
  }

  /** True when this client would talk to the real CyberTipline. */
  get isProduction(): boolean {
    return this.environment === "production";
  }

  private authHeader(): string {
    const raw = `${this.credentials.username}:${this.credentials.password}`;
    return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
  }

  private async request(
    path: string,
    init: { method: string; contentType: string; body?: string },
  ): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: init.method,
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": init.contentType,
        Accept: "text/xml",
      },
      ...(init.body === undefined ? {} : { body: init.body }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new EspClientError(
        "http_error",
        `CyberTipline ${init.method} ${path} returned ${response.status} in the ${this.environment} environment.`,
        response.status,
      );
    }
    return text;
  }

  /**
   * GET /status. The documented way to check that credentials work without
   * opening a report, which is the only safe thing to run against production.
   */
  async status(): Promise<ReportResponse> {
    const body = await this.request("/status", { method: "GET", contentType: "text/xml" });
    return this.parseReportResponse(body);
  }

  /**
   * POST /submit. Opens a report. The body is a single XML document conforming
   * to the report schema; the response carries the reportId.
   *
   * A report opened and never finished is deleted by NCMEC 24 hours after it is
   * opened, or an hour after the last modification, whichever is later. That is
   * NCMEC's clock, not Guardian's: Guardian's local draft persists on its own,
   * so a caller must not treat a missing NCMEC draft as a lost case.
   */
  async submit(report: CyberTiplineReport): Promise<ReportResponse> {
    if (report.environment !== this.environment) {
      throw new EspClientError(
        "production_not_explicit",
        `Refused: the report was built for the ${report.environment} environment and this client is pointed at ${this.environment}. A report crosses environments only by being rebuilt for the one it is going to.`,
      );
    }
    // These credentials belong to one provider and a submission on them is that
    // provider's filing under 18 USC 2258A. A report built for another customer
    // must not go out on them, whatever the caller intended (rule 8). Checked
    // only where the client was told which customer it is for; a client with no
    // customerId is a single-customer deployment and has nothing to compare.
    if (this.customerId !== undefined && this.customerId !== report.customerId) {
      throw new EspClientError(
        "customer_mismatch",
        `Refused: the report belongs to customer ${report.customerId} and these are customer ${this.customerId}'s CyberTipline credentials. The provider whose account a report is filed on is the reporter of record, so it has to be the provider the report is about.`,
      );
    }
    const body = await this.request("/submit", {
      method: "POST",
      contentType: "text/xml; charset=utf-8",
      body: toReportXml(report),
    });
    return this.parseReportResponse(body);
  }

  /**
   * POST /finish. Takes the report id as a form parameter. Once finished, no
   * further files or details can be added and the report cannot be cancelled,
   * so the one year preservation clock starts here (see preservation.ts).
   */
  async finish(reportId: string): Promise<ReportDoneResponse> {
    const body = await this.request("/finish", {
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({ id: reportId }).toString(),
    });
    return this.parseDoneResponse(body);
  }

  /**
   * POST /retract. Cancels a report that has not been finished. Available only
   * before /finish, which is why the reviewer console offers it in that window
   * and not after.
   */
  async retract(reportId: string): Promise<ReportResponse> {
    const body = await this.request("/retract", {
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({ id: reportId }).toString(),
    });
    return this.parseReportResponse(body);
  }

  /** GET /xsd. The authoritative schema, for checking this package against it. */
  async xsd(): Promise<string> {
    return this.request("/xsd", { method: "GET", contentType: "text/xml" });
  }

  private parseReportResponse(xml: string): ReportResponse {
    const parsed = reportResponseSchema.safeParse({
      responseCode: Number(tag(xml, "responseCode") ?? "0"),
      ...(tag(xml, "responseDescription")
        ? { responseDescription: tag(xml, "responseDescription") }
        : {}),
      ...(tag(xml, "reportId") ? { reportId: tag(xml, "reportId") } : {}),
      ...(tag(xml, "fileId") ? { fileId: tag(xml, "fileId") } : {}),
      ...(tag(xml, "hash") ? { hash: tag(xml, "hash") } : {}),
    });
    if (!parsed.success) {
      throw new EspClientError(
        "unparseable_response",
        "CyberTipline returned a response this client could not read as a reportResponse.",
      );
    }
    return parsed.data;
  }

  private parseDoneResponse(xml: string): ReportDoneResponse {
    const parsed = reportDoneResponseSchema.safeParse({
      responseCode: Number(tag(xml, "responseCode") ?? "0"),
      ...(tag(xml, "reportId") ? { reportId: tag(xml, "reportId") } : {}),
      files: allTags(xml, "fileId"),
    });
    if (!parsed.success) {
      throw new EspClientError(
        "unparseable_response",
        "CyberTipline returned a response this client could not read as a reportDoneResponse.",
      );
    }
    return parsed.data;
  }
}

/* -------------------------------------------------------------------------- */
/* XML                                                                        */
/* -------------------------------------------------------------------------- */

function tag(xml: string, name: string): string | undefined {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return match?.[1]?.trim();
}

function allTags(xml: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const value = match[1]?.trim();
    if (value) out.push(value);
  }
  return out;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function el(name: string, value: string | number | boolean | undefined): string {
  if (value === undefined || value === "") return "";
  return `<${name}>${esc(String(value))}</${name}>`;
}

/**
 * Serialize the envelope to the report XML.
 *
 * Element names and nesting follow the public documentation. The XSD at
 * GET /xsd is authoritative on cardinality and ordering and has not been read
 * against this function, so this is checked before the first production
 * submission rather than assumed correct.
 *
 * Guardian's own provenance block has no NCMEC element, so it is serialized
 * into additionalInfo along with the media hashes, the excerpt transcript, the
 * reporting provider's own jurisdiction and the legal basis for the processing.
 * There is no fileDetails element here and no file is referenced for upload,
 * because Guardian holds no bytes to upload.
 */
export function toReportXml(report: CyberTiplineReport): string {
  const s = report.incidentSummary;
  const annotations = s.reportAnnotations.map((a) => `<${a} />`).join("");
  const reported = report.personOrUserReported;

  const ips = (events: typeof reported.ipCaptureEvent): string =>
    events
      .map(
        (e) =>
          `<ipCaptureEvent>${el("ipAddress", e.ipAddress)}${el("eventName", e.eventName)}${el("dateTime", e.dateTime)}${el("possibleProxy", e.possibleProxy)}${el("port", e.port)}</ipCaptureEvent>`,
      )
      .join("");

  const person = (p: typeof report.reporter.reportingPerson): string =>
    `${el("firstName", p.firstName)}${el("lastName", p.lastName)}${el("email", p.email)}${el("phone", p.phone)}${el("address", p.address)}${el("age", p.age)}${el("dateOfBirth", p.dateOfBirth)}`;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<report>",
    "<incidentSummary>",
    el("incidentType", s.incidentType),
    el("platform", s.platform),
    el("escalateToHighPriority", s.escalateToHighPriority),
    annotations ? `<reportAnnotations>${annotations}</reportAnnotations>` : "",
    el("incidentDateTime", s.incidentDateTime),
    el("incidentDateTimeDescription", s.incidentDateTimeDescription),
    "</incidentSummary>",
    "<internetDetails>",
    `<${report.incidentChannel} />`,
    "</internetDetails>",
    "<reporter>",
    el("companyTemplate", report.reporter.companyTemplate),
    `<reportingPerson>${person(report.reporter.reportingPerson)}</reportingPerson>`,
    report.reporter.contactPerson
      ? `<contactPerson>${person(report.reporter.contactPerson)}</contactPerson>`
      : "",
    el("termsOfService", report.reporter.termsOfService),
    el("legalURL", report.reporter.legalURL),
    "</reporter>",
    "<personOrUserReported>",
    el("espIdentifier", reported.espIdentifier),
    el("espService", reported.espService),
    el("screenName", reported.screenName),
    el("displayName", reported.displayName),
    el("profileUrl", reported.profileUrl),
    ips(reported.ipCaptureEvent),
    reported.estimatedLocation
      ? `<estimatedLocation>${el("city", reported.estimatedLocation.city)}${el("region", reported.estimatedLocation.region)}${el("countryCode", reported.estimatedLocation.countryCode)}</estimatedLocation>`
      : "",
    el("additionalInfo", additionalInfo(report)),
    "</personOrUserReported>",
    report.victim
      ? `<victim>${el("espIdentifier", report.victim.espIdentifier)}${el("screenName", report.victim.screenName)}${ips(report.victim.ipCaptureEvent)}${report.victim.person ? `<victimPerson>${person(report.victim.person)}</victimPerson>` : ""}</victim>`
      : "",
    "</report>",
  ]
    .filter((line) => line !== "")
    .join("");
}

/**
 * Everything NCMEC has no element for: the narrative, the excerpts, the media
 * hashes with the operator's verdicts, and Guardian's provenance block. This is
 * the part of the report that answers the Stanford finding, so it is written
 * out in full rather than summarized.
 */
function additionalInfo(report: CyberTiplineReport): string {
  const g = report.guardian;
  const lines: string[] = [report.narrative, "", "Provenance"];
  lines.push(
    `Bundle: ${g.bundleId}`,
    `Audit chain head: ${g.auditHead}`,
    `Versions: model ${g.modelVersion}, lexicon ${g.lexiconVersion}, fusion ${g.fusionVersion}`,
    `Reviewer: ${g.reviewerId}${g.concurringReviewerId ? `, concurring reviewer ${g.concurringReviewerId}` : ""}`,
    `Decision: ${g.decision} at ${g.decidedAt}`,
    `Excerpts read by a person: ${g.excerptsViewedByHuman} of ${g.excerptsTotal}`,
    `Automated actor score was the sole basis: ${g.soleAutomatedBasis ? "yes" : "no"}`,
    `Originated with a law enforcement request: ${g.lawEnforcementRequested ? "yes" : "no"}`,
    `Incident type source: ${incidentTypeSourceLine(report)}`,
  );

  // Neither of these has an NCMEC element and both were computed and stored, so
  // they travel here rather than stopping at the envelope. additionalInfo is a
  // child of personOrUserReported, so the jurisdiction line says in words whose
  // jurisdiction it is: an analyst must not read it as the reported account's
  // location, which is what estimatedLocation carries.
  if (report.jurisdiction) {
    const sub = report.jurisdiction.subdivision;
    lines.push(
      `Reporting provider's own jurisdiction, which is where legal process reaches the provider and not the reported account's location: ${report.jurisdiction.country}${sub ? `-${sub}` : ""}`,
    );
  }
  if (report.legalBasis) {
    lines.push(`Legal basis for the processing that produced this evidence: ${report.legalBasis}`);
  }

  if (report.mediaHashes.length > 0) {
    lines.push("", "Media, identified by hash only");
    for (const m of report.mediaHashes) {
      lines.push(
        `${m.hashType} ${m.sha256} | provider scanner verdict: ${m.operatorVerdict}${m.operatorScanner ? ` (${m.operatorScanner})` : ""} | viewed by provider: ${m.fileViewedByEsp ? "yes" : "no"} | bytes held by provider: ${m.bytesHeldByOperator ? "yes" : "no"}`,
      );
    }
    lines.push(
      "No file content accompanies this report from the reporting system, which does not accept or store image or video bytes.",
    );
  }

  if (report.excerpts.length > 0) {
    lines.push("", "Conversation excerpts, in order, with timezone-explicit timestamps");
    for (const e of report.excerpts) {
      const who = e.direction === "actor_to_target" ? "reported account" : "receiving account";
      lines.push(
        `[${e.ts}] [${e.channel}] [${who}] [read by a person: ${e.viewedByHuman ? "yes" : "no"}] ${e.text ?? (e.mediaSha256 ? `media event, sha256 ${e.mediaSha256}` : "no text retained")}`,
      );
    }
  }

  return lines.join("\n");
}

/**
 * How the incident type was reached. A defaulted type is a routing decision
 * made by a fallback rather than by the traffic or by a person, and NCMEC
 * routes and prioritises on it, so the report says so rather than presenting
 * the default as a finding.
 */
function incidentTypeSourceLine(report: CyberTiplineReport): string {
  const g = report.guardian;
  switch (g.incidentTypeSource) {
    case "signals":
      return `derived from the recorded signals (${g.incidentTypeDrivenBy.join(", ")})`;
    case "reviewer":
      return "selected by the reviewer from facts the reporting system does not hold";
    default:
      return "not derivable from the recorded signals; this is the fallback type and no signal supports it";
  }
}
