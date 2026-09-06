import { z } from "zod";
import {
  jurisdictionSchema,
  legalBasisSchema,
  type Jurisdiction,
  type LegalBasis,
} from "./provenance.js";
import { reportFilingModeSchema, type ReportFilingMode } from "./types.js";

/**
 * Who the operator is, for the purpose of filing.
 *
 * Every field here was previously an argument to buildEvidenceBundle and lived
 * nowhere else, which meant a production bundle honestly reported all of them
 * empty while the e2e supplied them by hand to prove the path worked. They are
 * columns on the customer now, and this is the projection between the two.
 *
 * Nullable end to end on purpose. None of these exist before the operator
 * registers with NCMEC, and an unset field is visibly unset rather than a claim
 * nobody made. A bundle built from a customer who has registered nothing says
 * so, which is what the completeness scorer is for.
 */
export const customerReportingIdentitySchema = z
  .object({
    /**
     * IANA zone. The CyberTipline incident fields are asked in local time, and
     * an offset computed at filing gets the wrong answer for anything on the
     * far side of a daylight-saving boundary.
     */
    timezone: z.string().min(1).nullish(),
    jurisdiction: jurisdictionSchema.nullish(),
    legalBasis: legalBasisSchema.nullish(),
    /** The provider's name and identifier as registered with NCMEC. */
    providerName: z.string().max(200).nullish(),
    espId: z.string().max(128).nullish(),
    /**
     * Whether a named point of contact is on file. The details themselves stay
     * on the customer row and out of the bundle: a bundle travels to NCMEC and
     * to counsel, and the operator's staff contact is not evidence.
     */
    contactOnFile: z.boolean().default(false),
    /**
     * Agent filing only where the customer has ESP credentials and has asked
     * for it. Direct is the default because it is the mode that works with no
     * registration behind it.
     */
    filingMode: reportFilingModeSchema.default("customer_direct"),
  })
  .strict();
export type CustomerReportingIdentity = z.infer<typeof customerReportingIdentitySchema>;

/** The customer columns this projection reads. Named rather than imported from
 * the generated client, so packages/schema stays free of it. */
export interface CustomerIdentityRow {
  timezone?: string | null;
  jurisdictionCountry?: string | null;
  jurisdictionSubdivision?: string | null;
  legalBasis?: LegalBasis | null;
  ncmecProviderName?: string | null;
  ncmecEspId?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  /** Present only so a row can be passed whole. Never read into a bundle. */
  contactPhone?: string | null;
  /** Set when the customer's own NCMEC credentials are sealed on the row. */
  ncmecCredentialCiphertext?: string | null;
}

/**
 * Project a customer row onto the identity a bundle needs.
 *
 * Two judgements are made here rather than at each call site. A jurisdiction is
 * a country plus an optional subdivision, so a subdivision with no country is
 * dropped: "TX" alone does not identify a jurisdiction and half of one is worse
 * than none. And filing mode is derived rather than stored, because agent
 * filing is only possible with both an ESP id and sealed credentials, and a
 * stored flag would let those drift apart.
 */
export function reportingIdentityFrom(row: CustomerIdentityRow): CustomerReportingIdentity {
  const country = row.jurisdictionCountry ?? null;
  const jurisdiction: Jurisdiction | null =
    country === null ? null : { country, subdivision: row.jurisdictionSubdivision ?? null };

  const espId = row.ncmecEspId ?? null;
  const sealed = (row.ncmecCredentialCiphertext ?? null) !== null;
  const filingMode: ReportFilingMode =
    espId !== null && sealed ? "guardian_as_agent" : "customer_direct";

  return {
    timezone: row.timezone ?? null,
    jurisdiction,
    legalBasis: row.legalBasis ?? null,
    providerName: row.ncmecProviderName ?? null,
    espId,
    contactOnFile: Boolean(row.contactName) && Boolean(row.contactEmail),
    filingMode,
  };
}

/**
 * What is still missing before this customer can file, in the words an operator
 * would use. Empty means nothing is blocking; the report-side completeness
 * scorer still has the last word on any individual report.
 */
export function reportingIdentityGaps(identity: CustomerReportingIdentity): string[] {
  const gaps: string[] = [];
  if (!identity.timezone) gaps.push("No timezone, so incident times are reported in UTC.");
  if (!identity.jurisdiction) {
    gaps.push("No jurisdiction, which is the field NCMEC publishes a completeness rate for.");
  }
  if (!identity.legalBasis) gaps.push("No legal basis recorded for processing.");
  if (!identity.providerName) gaps.push("No provider name as registered with NCMEC.");
  if (!identity.espId) gaps.push("No ESP identifier, so a report is drafted rather than submitted.");
  if (!identity.contactOnFile) gaps.push("No named point of contact for a report.");
  return gaps;
}
