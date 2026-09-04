import { z } from "zod";

/**
 * Compliance provenance.
 *
 * These enums answer questions that arrive after the fact, from a regulator, a
 * reviewer or a court: where did this age band come from, was a human ever
 * shown this excerpt, under whose authority was the traffic processed, was the
 * channel private, and who wrote this piece of feedback. The answer belongs on
 * the row at the time the row is written. Reconstructing it later from logs is
 * the failure mode these fields exist to prevent.
 *
 * Not to be confused with `provenanceSchema` in types.ts, which records which
 * surface an event arrived on. That one travels with the evidence. This one is
 * the compliance record around it.
 */

/**
 * Where an age band came from. Roblox's June 2026 grouping, the Texas and
 * California statutory brackets and Regulation (EU) 2026/1881 all reason about
 * age differently, so the band alone is not enough. A band derived from a
 * Discord role is not the same claim as one from an identity document, and the
 * UK Online Safety Act's highly effective age assurance test turns on exactly
 * that difference.
 */
export const AGE_BAND_PROVENANCES = [
  "facial_estimate",
  "government_id",
  "os_bracket",
  "server_role",
  "platform_default",
  "customer_declared",
  "unknown",
] as const;
export type AgeBandProvenance = (typeof AGE_BAND_PROVENANCES)[number];
export const ageBandProvenanceSchema = z.enum(AGE_BAND_PROVENANCES);

/**
 * Confidence in the band, 0 to 1. Absent means the source published no
 * calibrated number, which is different from a low one. Callers must not read
 * a missing confidence as zero.
 */
export const ageBandConfidenceSchema = z.number().min(0).max(1);

/**
 * Under whose authority Guardian processes a customer's traffic.
 *
 * provider_2258a: the customer is the electronic service provider and the
 *   reporter of record under 18 USC 2258A.
 * processor: Guardian processes on the customer's written instructions.
 * parental_consent: the device owner authorized the parent surface, overtly.
 * operator_authority: the customer operates the service and acts on it, which
 *   is the Discord server owner case.
 */
export const LEGAL_BASES = [
  "provider_2258a",
  "processor",
  "parental_consent",
  "operator_authority",
] as const;
export type LegalBasis = (typeof LEGAL_BASES)[number];
export const legalBasisSchema = z.enum(LEGAL_BASES);

/**
 * Whether the channel an event came from was open to the service, closed to a
 * pair, or closed to a named set. Regulation (EU) 2026/1881, in force from
 * 31 July 2026 to 3 April 2028, permits detection in private messaging only on
 * risk factors such as age difference and only with human confirmation before
 * any report, so private traffic cannot be scored under the same rules as a
 * public channel.
 */
export const CHANNEL_VISIBILITIES = ["public", "private", "group"] as const;
export type ChannelVisibility = (typeof CHANNEL_VISIBILITIES)[number];
export const channelVisibilitySchema = z.enum(CHANNEL_VISIBILITIES);

/**
 * The stricter path applies unless the customer said otherwise. An event that
 * arrived without a stated visibility is treated as private messaging, so a
 * customer who never sets the field gets the conservative rule rather than the
 * permissive one. This is the single place that decision is made.
 */
export function treatAsPrivateMessaging(
  visibility: ChannelVisibility | null | undefined,
): boolean {
  return visibility !== "public";
}

/**
 * Who produced a piece of feedback that can reach the lexicon mining loop.
 *
 * The dismissal control on the mod-channel card is a write path, and anyone
 * with moderator permissions in the guild can use it, including an account the
 * card is about. Recording the writer is the first half of the fix. The second
 * half is a rate limit and an anomaly check at the point of write, which lives
 * in the surface, not here.
 */
export const FEEDBACK_SOURCES = ["reviewer", "moderator", "automated", "unknown"] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];
export const feedbackSourceSchema = z.enum(FEEDBACK_SOURCES);

/** Attribution carried by anything that can feed the lexicon mining loop. */
export const feedbackAttributionSchema = z
  .object({
    source: feedbackSourceSchema.default("unknown"),
    /** Salted hash of whoever wrote it, on the same scheme as every other uid. */
    byUid: z.string().max(256).nullish(),
    at: z.coerce.date(),
  })
  .strict();
export type FeedbackAttribution = z.infer<typeof feedbackAttributionSchema>;

/**
 * Where the customer operates. ISO 3166-1 alpha-2 country, plus the ISO 3166-2
 * subdivision suffix on its own when a state or province rule applies, so "TX"
 * rather than "US-TX". Over 10 percent of industry CyberTipline reports in 2025
 * lacked enough data to determine jurisdiction; carrying it on the customer is
 * what keeps it off the reporter's to do list.
 */
export const jurisdictionSchema = z
  .object({
    country: z.string().regex(/^[A-Z]{2}$/, "country must be an ISO 3166-1 alpha-2 code"),
    subdivision: z
      .string()
      .regex(/^[A-Z0-9]{1,3}$/, "subdivision must be the ISO 3166-2 suffix, without the country")
      .nullish(),
  })
  .strict();
export type Jurisdiction = z.infer<typeof jurisdictionSchema>;

/** Full ISO 3166-2 form for display and for the report bundle. */
export function formatJurisdiction(j: Jurisdiction): string {
  return j.subdivision ? `${j.country}-${j.subdivision}` : j.country;
}

/** Per-customer compliance record. Nullable end to end: an unset basis is
 * visibly unset rather than a claim nobody made. */
export const customerComplianceSchema = z
  .object({
    jurisdiction: jurisdictionSchema.nullish(),
    legalBasis: legalBasisSchema.nullish(),
  })
  .strict();
export type CustomerCompliance = z.infer<typeof customerComplianceSchema>;
