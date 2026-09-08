import type { EvidenceBundle, ReviewerContext, SignalHit, SignalKind, Stage } from "@guardian/schema";
import type { ReportCustomer } from "../src/builder.js";
import type { ReportedAccount } from "../src/schema.js";

export const MEDIA_HASH = "a".repeat(64);

type TimelineRow = EvidenceBundle["timeline"][number];

/**
 * A bundle shaped the way apps/scorer builds one, at whatever tier the caller
 * asks for. Nothing here reaches the network or the database.
 */
export function bundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  const base: EvidenceBundle = {
    bundleId: "bdl_test_0001",
    customerId: "cus_test",
    actorUid: ACTOR_UID,
    targetUid: TARGET_UID,
    tier: "T3",
    timeline: [
      row("2026-08-01T10:00:00.000Z", "actor_to_target", "hey how old are you, whats your snap"),
      row("2026-08-01T10:04:00.000Z", "target_to_actor", "im 13"),
      row("2026-08-01T10:09:00.000Z", "actor_to_target", "add me on snapchat, dont tell your mum"),
      row("2026-08-01T11:30:00.000Z", "actor_to_target", "send me a pic of you"),
      row("2026-08-01T12:15:00.000Z", "actor_to_target", "if you dont pay ill send it to everyone"),
      row("2026-08-01T12:20:00.000Z", "actor_to_target", "you have an hour"),
    ],
    signals: [
      signal("supervision_probe", "probe"),
      signal("off_platform_migration", "migrate"),
      signal("secrecy_instruction", "trust"),
      signal("image_solicitation", "sexualize"),
      signal("payment_after_media", "coerce"),
      signal("threat_template", "coerce"),
    ],
    versions: {
      modelVersion: "kernel-v0",
      lexiconVersion: "v2",
      fusionVersion: "rules-v2",
    },
    provenance: [],
    jurisdiction: { country: "US", subdivision: "TX" },
    legalBasis: "provider_2258a",
    reporter: {
      customerId: "cus_test",
      providerName: "Example Games",
      espId: "esp_example",
      filingMode: "guardian_as_agent",
      contactOnFile: true,
    },
    timezone: "America/Chicago",
    timezoneSource: "customer",
    generatedAt: new Date("2026-08-02T09:00:00.000Z"),
    generatedAtLocal: "2026-08-02T04:00:00-05:00",
    generatedAtOffsetMinutes: -300,
    reviewer: reviewer(),
    completeness: { fields: [], missing: [], complete: false },
    retention: "CASE_1Y",
    auditHead: "d".repeat(64),
  };
  return { ...base, ...overrides };
}

export function row(
  ts: string,
  direction: "actor_to_target" | "target_to_actor",
  excerpt: string | null,
  extra: Partial<TimelineRow> = {},
): TimelineRow {
  return {
    ts: new Date(ts),
    channel: "dm",
    direction,
    excerpt,
    mediaSha256: null,
    knownCsamVerdict: null,
    stage: null,
    signals: [],
    viewedByHuman: true,
    actorAge: { band: "A21_PLUS", confidence: 0.8, provenance: "server_role" },
    targetAge: { band: "A13_15", confidence: 0.7, provenance: "server_role" },
    ...extra,
  };
}

function signal(kind: SignalKind, stage: Stage): SignalHit {
  return {
    kind,
    stage,
    weight: 1,
    matched: "normalized token match",
    viewedByHuman: false,
  } as SignalHit;
}

/** The two accounts on the fixture pair, named so the account map can key on them. */
export const ACTOR_UID = "b".repeat(64);
export const TARGET_UID = "c".repeat(64);

export function reviewer(overrides: Partial<ReviewerContext> = {}): ReviewerContext {
  return {
    reviewerId: "rev_alice",
    reviewId: "rvw_1",
    decision: "report",
    priorTier: "T2",
    resultTier: "T3",
    decidedAt: new Date("2026-08-02T08:30:00.000Z"),
    decidedAtLocal: "2026-08-02T03:30:00-05:00",
    decidedAtOffsetMinutes: -300,
    reasonCode: "sextortion_pattern",
    notes: {
      timeline: "Migration ask at ten minutes, image solicitation at ninety, demand at two hours.",
      outsideContext: "The receiving account's role in the server puts it in the 13 to 15 band.",
      recommendation:
        "The compression from first contact to a payment demand is under three hours, which is the sprint pattern rather than a slow build, and the receiving account stated an age in band on the second message.",
    },
    viewedExcerptCount: 6,
    concurringReviewerId: "rev_bob",
    // Set here because a report cannot be built without it. NCMEC displays
    // personOrUserReported as the suspect, so a reviewer names the account and
    // Guardian never derives it from which side the detectors scored.
    reportedSubject: {
      uid: ACTOR_UID,
      designatedByReviewerId: "rev_alice",
      designatedAt: new Date("2026-08-02T08:30:00.000Z"),
    },
    ...overrides,
  };
}

/**
 * Role-keyed account overrides, mapped onto the uid-keyed shape the builder
 * takes. The tests are about roles ("the reported account has no IP capture"),
 * and the builder is uid-keyed so a reviewer's designation decides which uid
 * holds which role. This is the one place the two vocabularies meet.
 */
export function accountsFor(
  reported: Partial<ReportedAccount> | undefined,
  victim?: Partial<ReportedAccount> | undefined,
): ReportCustomer["accounts"] {
  const out: NonNullable<ReportCustomer["accounts"]> = {};
  if (reported) out[ACTOR_UID] = reported;
  if (victim) out[TARGET_UID] = victim;
  return out;
}

/** A customer with everything a routable report needs. */
export function customer(overrides: Partial<ReportCustomer> = {}): ReportCustomer {
  return {
    customerId: "cus_test",
    providerName: "Example Games",
    platform: "Example Games chat",
    reportingPerson: {
      firstName: "Dana",
      lastName: "Okafor",
      email: "trust-and-safety@example.test",
      phone: "+1-555-0100",
    },
    contactPerson: { firstName: "Dana", lastName: "Okafor", email: "legal@example.test" },
    // Keyed by the account's salted hash, so the reviewer's designation
    // decides which one lands under the suspect heading.
    // Keyed by the account's salted hash, so the reviewer's designation decides
    // which one lands under the suspect heading.
    accounts: {
      [ACTOR_UID]: {
        espIdentifier: "user-88213",
        screenName: "player88213",
        espService: "Example Games chat",
        ipCaptureEvent: [
          {
            ipAddress: "203.0.113.24",
            eventName: "Message Sent",
            dateTime: "2026-08-01T12:15:00-05:00",
          },
        ],
        estimatedLocation: { city: "Austin", region: "TX", countryCode: "US" },
      },
      [TARGET_UID]: {
        espIdentifier: "user-44190",
        screenName: "player44190",
        person: { age: 13 },
      },
    },
    mediaScanner: "PhotoDNA run by the provider",
    environment: "test",
    ...overrides,
  };
}
