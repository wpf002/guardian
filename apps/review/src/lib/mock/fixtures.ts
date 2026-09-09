/**
 * In-memory fixtures, so the console runs, renders and screenshots without a
 * database.
 *
 * The conversations are the shapes from apps/scorer/test/kernel.test.ts: the
 * grooming ladder, the sextortion script, teen romance and a handle swap. Two
 * of those are controls, and a queue fixture that only contains positives
 * teaches the wrong thing about what a shift looks like.
 *
 * Everything is generated from one seed, so two runs produce the same ids, the
 * same hashes and the same audit chain. Timestamps are offsets from the moment
 * the fixtures are first built, so the SLA figures stay sensible whenever the
 * app is started.
 */

import { AuditLog, MemoryAuditStore, type AuditEntry, type AuditKind } from "@guardian/audit";
import { hashUid, sha256Hex, type Tier } from "@guardian/schema";
import { compose } from "../compose";
import { MOCK_REVIEWER } from "../session";
import type {
  ActorContext,
  BandReading,
  CaseDetail,
  CustomerSettings,
  GuildConfigView,
  PriorCase,
  QueueExcerpt,
  ReviewRecord,
  Speaker,
  StagePoint,
  TimelineRow,
  TimelineState,
} from "../data/types";

export const MOCK_CUSTOMER_ID = "cus_northwood";
export const MOCK_CUSTOMER_NAME = "Northwood Gaming";
const MOCK_SALT = sha256Hex("guardian-mock-salt");
const MOCK_AUDIT_SECRET = "guardian-mock-audit-secret";

const VERSIONS = {
  modelVersion: "rules-v2",
  lexiconVersion: "v2",
  fusionVersion: "rules-v2",
} as const;

/** Deterministic PRNG. Small, seeded, and the same on every machine. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface MockPair extends CaseDetail {
  timeline: TimelineState;
}

export interface MockData {
  customer: CustomerSettings;
  pairs: MockPair[];
  reviews: ReviewRecord[];
  guilds: GuildConfigView[];
  auditLog: AuditLog;
  auditStore: MemoryAuditStore;
  auditEntries: AuditEntry[];
  activeSeats: number;
  /** Anchor the whole fixture set is offset from. */
  now: Date;
}

interface LineSpec {
  s: Speaker;
  atMin: number;
  text?: string;
  collapsed?: TimelineRow["collapsed"];
  media?: TimelineRow["media"];
  stage?: TimelineRow["stage"];
  confidence?: number;
  lowConfidence?: boolean;
  signals?: string[];
  normalizations?: TimelineRow["normalizations"];
  viewedByHuman?: boolean;
  visibility?: TimelineRow["channelVisibility"];
}

interface PairSpec {
  id: string;
  tier: Tier;
  criticalSignals: string[];
  patternClause: string;
  whySentence: string;
  actorBand: BandReading;
  targetBand: BandReading;
  actorContext: string;
  suggestedPosture: "enforcement" | "support" | null;
  targetSource?: "reply" | "mention" | "adjacency" | null;
  soleAutomatedBasis: boolean;
  channel: string;
  slaRemainingMinutes: number | null;
  claim: MockPair["queue"]["claim"];
  /** Seeds humanViewedAt. The queue's unread flag is derived from that, never set here. */
  unread: boolean;
  openedMinutesAgo: number;
  resolvedMinutesAgo?: number;
  features: CaseDetail["features"];
  stages: Array<{ stage: StagePoint["stage"]; atMin: number }>;
  velocityWindow: string | null;
  actor: Omit<ActorContext, "hashedUid" | "band">;
  actorUid: string;
  targetUid: string;
  priorCases: PriorCase[];
  policyCriteria: string | null;
  lines: LineSpec[];
  /** Set on a pair whose excerpts have already been deleted under retention. */
  expiredOn?: number;
}

function band(
  value: BandReading["band"],
  confidence: number | null,
  provenance: BandReading["provenance"],
): BandReading {
  return { band: value, confidence, provenance };
}

const BAND_WORDS: Record<string, string> = {
  UNDER_9: "under 9",
  A9_12: "9-12",
  A13_15: "13-15",
  A16_17: "16-17",
  A18_20: "18-20",
  A21_PLUS: "21+",
  UNKNOWN: "band unknown",
};

export function bandWord(value: BandReading["band"]): string {
  return BAND_WORDS[value] ?? "band unknown";
}

/** The grooming ladder from kernel.test.ts, annotated as the console renders it. */
const LADDER_LINES: LineSpec[] = [
  { s: "t", atMin: 0, text: "hey nice build in that game", stage: "contact", confidence: 0.44, lowConfidence: true },
  { s: "s1", atMin: 1, text: "thanks lol" },
  {
    s: "t",
    atMin: 3,
    text: "what do you like to play? i can send you some robux if you want",
    stage: "trust",
    confidence: 0.62,
    signals: ["economic_bait"],
  },
  { s: "s1", atMin: 4, text: "omg really" },
  {
    s: "t",
    atMin: 8,
    text: "are your parents home right now? do they check your phone?",
    stage: "probe",
    confidence: 0.81,
    signals: ["supervision_probe"],
  },
  { s: "s1", atMin: 9, text: "no theyre at work" },
  {
    s: "t",
    atMin: 12,
    text: "cool. add me on snapchat, my snap is ryan_xx99, easier to talk there",
    stage: "migrate",
    confidence: 0.77,
    signals: ["off_platform_migration"],
    normalizations: [
      {
        normalized: "snapchat",
        original: "\u{1F47B}",
        entry: "migration.snapchat.emoji",
        lexiconVersion: "v2",
      },
    ],
  },
  { s: "s1", atMin: 13, text: "ok" },
  {
    s: "t",
    atMin: 15,
    text: "dont tell anyone we talk ok, our secret",
    stage: "migrate",
    confidence: 0.58,
    signals: ["secrecy_instruction"],
  },
  { s: "s2", atMin: 60, text: "anyone up for a round later" },
  {
    s: "t",
    atMin: 19 * 60,
    media: {
      sha256: sha256Hex("mock-media-4f2a"),
      direction: "older_to_younger",
      verdict: "no_match",
      viewedByOperatorHuman: false,
    },
  },
  {
    s: "t",
    atMin: 19 * 60 + 3,
    text: "send me 200 on cashapp right now or i send this to everyone you know",
    collapsed: { spanClass: "threat", wordCount: 22 },
    stage: "coerce",
    confidence: 0.66,
    signals: ["threat_template"],
  },
  { s: "s1", atMin: 19 * 60 + 4, text: "please dont", stage: "none", confidence: 0.31, lowConfidence: true },
  { s: "s1", atMin: 19 * 60 + 9, text: "i dont have any money" },
];

const TEEN_ROMANCE_LINES: LineSpec[] = [
  { s: "t", atMin: 0, text: "hey you were funny in vc last night", stage: "contact", confidence: 0.38, lowConfidence: true },
  { s: "s1", atMin: 2, text: "haha thanks" },
  { s: "t", atMin: 5, text: "u single? lol", stage: "trust", confidence: 0.41 },
  { s: "s1", atMin: 6, text: "maybe why" },
  {
    s: "t",
    atMin: 9,
    text: "add me on snap, my user is jayden.k",
    stage: "migrate",
    confidence: 0.55,
    signals: ["off_platform_migration"],
  },
  { s: "s1", atMin: 10, text: "added you" },
  { s: "t", atMin: 30, text: "wanna be my girlfriend" },
  { s: "s1", atMin: 33, text: "yes lol" },
];

const HANDLE_SWAP_LINES: LineSpec[] = [
  { s: "t", atMin: 0, text: "whats your snap", stage: "migrate", confidence: 0.34, lowConfidence: true, signals: ["off_platform_migration"] },
  { s: "s1", atMin: 1, text: "its miamia03 whats urs" },
  { s: "t", atMin: 2, text: "added you" },
  { s: "s1", atMin: 3, text: "cool" },
];

const SEXTORTION_LINES: LineSpec[] = [
  { s: "t", atMin: 0, text: "hey you look cute, wanna trade pics", stage: "sexualize", confidence: 0.72, signals: ["image_solicitation"] },
  { s: "s1", atMin: 2, text: "idk" },
  { s: "t", atMin: 3, text: "ill send mine first", stage: "sexualize", confidence: 0.64 },
  {
    s: "s1",
    atMin: 6,
    media: {
      sha256: sha256Hex("mock-media-c5e1"),
      direction: "younger_to_older",
      verdict: "not_run",
      viewedByOperatorHuman: false,
    },
  },
  {
    s: "t",
    atMin: 9,
    text: "send me 200 on cashapp right now or i send this to everyone you know",
    collapsed: { spanClass: "payment_coercion", wordCount: 17 },
    stage: "coerce",
    confidence: 0.88,
    signals: ["payment_after_media", "threat_template"],
  },
];

const ECONOMIC_BAIT_LINES: LineSpec[] = [
  { s: "t", atMin: 0, text: "im giving away robux to the first 5 people who add me", stage: "trust", confidence: 0.52, signals: ["economic_bait"] },
  { s: "s1", atMin: 4, text: "me me me" },
  { s: "t", atMin: 6, text: "cool whats your username" },
  { s: "s1", atMin: 7, text: "its bx_kai" },
];

const COERCION_LINES: LineSpec[] = [
  { s: "t", atMin: 0, text: "you said you would do it", stage: "coerce", confidence: 0.59 },
  { s: "s1", atMin: 3, text: "i dont want to" },
  {
    s: "t",
    atMin: 5,
    text: "you have to do it and send me proof or im telling everyone",
    collapsed: { spanClass: "coercion", wordCount: 14 },
    stage: "coerce",
    confidence: 0.71,
    signals: ["coercion_nonfinancial"],
  },
  { s: "s1", atMin: 9, text: "ok" },
];

function specs(): PairSpec[] {
  return [
    {
      id: "pair_4f2a",
      tier: "T2",
      criticalSignals: ["threat_template"],
      patternClause: "Asked who supervises the younger account, then asked to move to Snapchat",
      whySentence:
        "An account in the 16-17 band asked who supervises the younger account's phone, then asked to continue on another app 19 hours later. A threat-template match followed.",
      actorBand: band("A16_17", 0.42, "server_role"),
      targetBand: band("A9_12", 0.61, "server_role"),
      actorContext: "This account is in 3 conversations like this one this week.",
      suggestedPosture: "enforcement",
      soleAutomatedBasis: false,
      channel: "#general",
      slaRemainingMinutes: 161,
      claim: { state: "unclaimed" },
      unread: true,
      openedMinutesAgo: 19 * 60 + 20,
      features: [
        { label: "progression 3 to 4", weight: 0.38, critical: false },
        { label: "threat template", weight: 0.31, critical: true },
        { label: "age-gap multiplier", weight: 0.18, critical: false },
      ],
      stages: [
        { stage: "contact", atMin: 0 },
        { stage: "trust", atMin: 3 },
        { stage: "probe", atMin: 8 },
        { stage: "migrate", atMin: 12 },
        { stage: "coerce", atMin: 19 * 60 + 3 },
      ],
      velocityWindow: "4h",
      actorUid: "northwood:ryan_xx99",
      targetUid: "northwood:kai_b",
      actor: {
        accountAgeHours: 11 * 24,
        pairsInWindow: 3,
        fanOut7d: 3,
        minorFanOut7d: 3,
        fanIn7d: 0,
        altClusterSize: 0,
        elevatedRole: null,
      },
      priorCases: [
        {
          pairId: "pair_7d40",
          shortId: "7d40",
          decidedAt: new Date(0),
          decision: "dismiss",
          resultTier: "T0",
          reasonLabel: "Teen romance, lawful",
        },
      ],
      policyCriteria:
        "A progression pattern across two stages, or any one critical signal.",
      lines: LADDER_LINES,
    },
    {
      id: "pair_91c7",
      tier: "T2",
      criticalSignals: [],
      patternClause: "Asked the younger account to carry on the conversation somewhere else",
      whySentence:
        "An account in the 18-20 band asked to continue the conversation on another app 9 minutes after first contact with an account in the 13-15 band.",
      actorBand: band("A18_20", 0.55, "server_role"),
      targetBand: band("A13_15", null, "platform_default"),
      actorContext: "First time Guardian has seen this account.",
      suggestedPosture: "enforcement",
      soleAutomatedBasis: false,
      channel: "#lfg",
      slaRemainingMinutes: 192,
      claim: { state: "other", who: "M. Osei", sinceMinutes: 4 },
      unread: false,
      openedMinutesAgo: 40,
      features: [
        { label: "migration ask", weight: 0.34, critical: false },
        { label: "age-gap multiplier", weight: 0.22, critical: false },
        { label: "velocity, 4h window", weight: 0.14, critical: false },
      ],
      stages: [
        { stage: "contact", atMin: 0 },
        { stage: "trust", atMin: 5 },
        { stage: "migrate", atMin: 9 },
      ],
      velocityWindow: "4h",
      actorUid: "northwood:jayden_k",
      targetUid: "northwood:mia_03",
      actor: {
        accountAgeHours: 400,
        pairsInWindow: 1,
        fanOut7d: 1,
        minorFanOut7d: 1,
        fanIn7d: 0,
        altClusterSize: 0,
        elevatedRole: null,
      },
      priorCases: [],
      policyCriteria:
        "A progression pattern across two stages, or any one critical signal.",
      lines: TEEN_ROMANCE_LINES,
    },
    {
      id: "pair_0b3e",
      tier: "T2",
      criticalSignals: ["coercion_nonfinancial"],
      patternClause: "Language demanding self-harm and proof of it, between two accounts in the same age band",
      whySentence:
        "Both accounts sit in the 13-15 band. A directive with a proof demand was recorded, and no payment was asked for.",
      actorBand: band("A13_15", 0.66, "server_role"),
      targetBand: band("A13_15", 0.7, "server_role"),
      actorContext: "First time Guardian has seen either account.",
      suggestedPosture: "support",
      soleAutomatedBasis: false,
      channel: "#voice-text",
      slaRemainingMinutes: 220,
      // Claimed and unproposed, which is the other half of the pair with 91c7:
      // a claim makes a case read only, and an open proposal outranks a claim.
      claim: { state: "other", who: "M. Osei", sinceMinutes: 12 },
      unread: true,
      openedMinutesAgo: 100,
      features: [
        { label: "coercion, non-financial", weight: 0.41, critical: true },
        { label: "same band, no gap", weight: -0.2, critical: false },
        { label: "velocity, 4h window", weight: 0.11, critical: false },
      ],
      stages: [{ stage: "coerce", atMin: 5 }],
      velocityWindow: "4h",
      actorUid: "northwood:sam_r",
      targetUid: "northwood:noa_t",
      actor: {
        accountAgeHours: 5000,
        pairsInWindow: 1,
        fanOut7d: 1,
        minorFanOut7d: 1,
        fanIn7d: 0,
        altClusterSize: 0,
        elevatedRole: null,
      },
      priorCases: [],
      policyCriteria:
        "A progression pattern across two stages, or any one critical signal.",
      lines: COERCION_LINES,
    },
    {
      id: "pair_aa19",
      tier: "T1",
      criticalSignals: [],
      patternClause: "Offered in-game currency, and nothing else was recorded",
      whySentence:
        "An account offered in-game currency to accounts that add it. No further stage was reached.",
      actorBand: band("UNKNOWN", null, "unknown"),
      targetBand: band("A13_15", null, "platform_default"),
      actorContext: "Nothing progressed here.",
      suggestedPosture: null,
      soleAutomatedBasis: false,
      channel: "#general",
      slaRemainingMinutes: null,
      claim: { state: "unclaimed" },
      unread: false,
      openedMinutesAgo: 300,
      features: [
        { label: "economic bait", weight: 0.24, critical: false },
        { label: "band unknown on one side", weight: -0.1, critical: false },
      ],
      stages: [{ stage: "trust", atMin: 0 }],
      velocityWindow: null,
      actorUid: "northwood:giveaway_bot9",
      targetUid: "northwood:bx_kai",
      actor: {
        accountAgeHours: 60,
        pairsInWindow: 4,
        fanOut7d: 4,
        minorFanOut7d: 2,
        fanIn7d: 0,
        altClusterSize: 2,
        elevatedRole: null,
      },
      priorCases: [],
      policyCriteria: null,
      lines: ECONOMIC_BAIT_LINES,
    },
    {
      id: "pair_7d40",
      tier: "T1",
      criticalSignals: [],
      patternClause: "Two accounts in the same age band swapped handles",
      whySentence:
        "Two accounts in the 13-15 band exchanged usernames for another app. Nothing else in the window carried a signal.",
      actorBand: band("A13_15", 0.72, "server_role"),
      targetBand: band("A13_15", 0.69, "server_role"),
      actorContext: "First time Guardian has seen this account.",
      suggestedPosture: null,
      soleAutomatedBasis: false,
      channel: "#general",
      slaRemainingMinutes: null,
      claim: { state: "unclaimed" },
      unread: false,
      openedMinutesAgo: 600,
      features: [{ label: "migration ask", weight: 0.19, critical: false }],
      stages: [{ stage: "migrate", atMin: 0 }],
      velocityWindow: null,
      actorUid: "northwood:mia_03",
      targetUid: "northwood:lu_88",
      actor: {
        accountAgeHours: 9000,
        pairsInWindow: 1,
        fanOut7d: 1,
        minorFanOut7d: 1,
        fanIn7d: 0,
        altClusterSize: 0,
        elevatedRole: "server moderator",
      },
      priorCases: [],
      policyCriteria: null,
      lines: HANDLE_SWAP_LINES,
    },
    {
      id: "pair_3c88",
      tier: "T1",
      criticalSignals: [],
      patternClause: "Nothing was recorded here; the tier rests on what the older account did elsewhere",
      whySentence:
        "The per-actor score alone stands behind this tier. Nothing on this pair carried a signal.",
      actorBand: band("A18_20", null, "platform_default"),
      targetBand: band("A16_17", null, "platform_default"),
      actorContext: "This account is in 5 conversations like this one this week.",
      suggestedPosture: null,
      soleAutomatedBasis: true,
      channel: "#clips",
      slaRemainingMinutes: null,
      claim: { state: "unclaimed" },
      unread: false,
      openedMinutesAgo: 900,
      features: [{ label: "actor skew, 7 day", weight: 0.28, critical: false }],
      stages: [],
      velocityWindow: null,
      actorUid: "northwood:vex_1",
      targetUid: "northwood:pip_2",
      actor: {
        accountAgeHours: 200,
        pairsInWindow: 5,
        fanOut7d: 5,
        minorFanOut7d: 3,
        fanIn7d: 1,
        altClusterSize: 1,
        elevatedRole: null,
      },
      priorCases: [],
      policyCriteria: null,
      lines: [],
      expiredOn: 26 * 60,
    },
    {
      id: "pair_c5e1",
      tier: "T3",
      criticalSignals: ["payment_after_media", "threat_template"],
      patternClause: "A payment demand four minutes after an image was sent",
      whySentence:
        "An account in the 21+ band solicited an image from an account in the 13-15 band, then demanded payment 3 minutes after the media event.",
      actorBand: band("A21_PLUS", 0.81, "customer_declared"),
      targetBand: band("A13_15", 0.74, "server_role"),
      actorContext: "This account is in 2 conversations like this one this week.",
      suggestedPosture: "enforcement",
      soleAutomatedBasis: false,
      channel: "#dm-bridge",
      slaRemainingMinutes: null,
      claim: { state: "unclaimed" },
      unread: false,
      openedMinutesAgo: 3 * 24 * 60,
      resolvedMinutesAgo: 3 * 24 * 60 - 40,
      features: [
        { label: "payment after media", weight: 0.46, critical: true },
        { label: "threat template", weight: 0.29, critical: true },
        { label: "age-gap multiplier", weight: 0.21, critical: false },
      ],
      stages: [
        { stage: "sexualize", atMin: 0 },
        { stage: "coerce", atMin: 9 },
      ],
      velocityWindow: "4h",
      actorUid: "northwood:acct_9931",
      targetUid: "northwood:rae_k",
      actor: {
        accountAgeHours: 30,
        pairsInWindow: 2,
        fanOut7d: 2,
        minorFanOut7d: 2,
        fanIn7d: 0,
        altClusterSize: 3,
        elevatedRole: null,
      },
      priorCases: [],
      policyCriteria:
        "A progression pattern across two stages, or any one critical signal.",
      lines: SEXTORTION_LINES,
    },
  ];
}

function buildTimeline(spec: PairSpec, start: Date): TimelineState {
  if (spec.expiredOn !== undefined) {
    return { state: "expired", deletedOn: new Date(start.getTime() + spec.expiredOn * MINUTE) };
  }
  if (spec.lines.length === 0) return { state: "empty" };

  const rows: TimelineRow[] = [];
  let previousAt: number | null = null;
  let index = 0;
  for (const line of spec.lines) {
    const at = new Date(start.getTime() + line.atMin * MINUTE);
    const gapHours =
      previousAt === null ? null : (at.getTime() - previousAt) / HOUR;
    rows.push({
      id: `${spec.id}_row_${index}`,
      at,
      speaker: line.s,
      bandLabel:
        line.s === "t"
          ? `${bandWord(spec.actorBand.band)} band`
          : `${bandWord(spec.targetBand.band)} band`,
      text: line.text ?? null,
      collapsed: line.collapsed ?? null,
      normalizations: line.normalizations ?? [],
      stage: line.stage ?? null,
      confidence: line.confidence ?? null,
      lowConfidence: line.lowConfidence ?? false,
      signals: line.signals ?? [],
      media: line.media ?? null,
      viewedByHuman: line.viewedByHuman ?? false,
      // Public unless the line says otherwise. A guild's open channels are
      // where the bot reads, and a fixture that claimed everything was a DM
      // would render a state the Discord surface does not produce.
      channelVisibility: line.visibility ?? "public",
      gapHoursBefore: gapHours !== null && gapHours >= 2 ? Math.round(gapHours) : null,
    });
    previousAt = at.getTime();
    index += 1;
  }
  const collapsedThirdParty = rows.filter((r) => r.speaker === "s2").length;
  return {
    state: "ready",
    rows,
    messageCount: rows.length,
    collapsedThirdParty,
  };
}

function buildStagePath(spec: PairSpec, start: Date): StagePoint[] {
  let previous: number | null = null;
  return spec.stages.map((entry) => {
    const reachedAt = new Date(start.getTime() + entry.atMin * MINUTE);
    const elapsed = previous === null ? null : (reachedAt.getTime() - previous) / HOUR;
    previous = reachedAt.getTime();
    return {
      stage: entry.stage,
      reachedAt,
      elapsedHoursFromPrevious: elapsed === null ? null : Math.round(elapsed * 10) / 10,
    };
  });
}

function buildPair(spec: PairSpec, now: Date, auditSeq: number | null): MockPair {
  const start = new Date(now.getTime() - spec.openedMinutesAgo * MINUTE);
  const timeline = buildTimeline(spec, start);
  const rows = timeline.state === "ready" ? timeline.rows : [];
  const spanHours =
    rows.length > 1
      ? Math.round((rows[rows.length - 1]!.at.getTime() - rows[0]!.at.getTime()) / HOUR)
      : 0;
  const mediaEventCount = rows.filter((r) => r.media !== null).length;
  const resolvedAt =
    spec.resolvedMinutesAgo === undefined
      ? null
      : new Date(now.getTime() - spec.resolvedMinutesAgo * MINUTE);
  /**
   * One fact, two readers. spec.unread seeds this rather than the queue flag,
   * so the fixture cannot hold a pair that is both unread and already viewed:
   * the queue's unread is derived from it, and marking an excerpt read updates
   * it, which is what the database mapper does.
   */
  const humanViewedAt = spec.unread ? null : new Date(now.getTime() - 3 * 24 * HOUR);

  return {
    queue: {
      pairId: spec.id,
      shortId: spec.id.slice(-4),
      customerId: MOCK_CUSTOMER_ID,
      customerName: MOCK_CUSTOMER_NAME,
      channel: spec.channel,
      tier: spec.tier,
      criticalSignals: spec.criticalSignals,
      patternClause: compose(`fixtures.patternClause.${spec.id}`, spec.patternClause),
      actorBand: spec.actorBand,
      targetBand: spec.targetBand,
      actorContext: compose(`fixtures.actorContext.${spec.id}`, spec.actorContext),
      suggestedPosture: spec.suggestedPosture,
      targetSource: spec.targetSource ?? "reply",
      soleAutomatedBasis: spec.soleAutomatedBasis,
      messageCount: rows.length,
      spanHours,
      mediaEventCount,
      excerpt: queueExcerpt(rows),
      stagesReached: buildStagePath(spec, start).filter((p) => p.reachedAt !== null).length,
      createdAt: start,
      slaRemainingMinutes: spec.slaRemainingMinutes,
      claim: spec.claim,
      // Derived, exactly as the database mapper derives it, so a read in mock
      // mode clears the dot the way it does in production.
      unread: humanViewedAt === null,
      // Filled in by linkProposals once the review rows exist: a proposal is a
      // review, and the queue reads it the same way the database branch does.
      proposal: null,
      updatedAt: rows.length > 0 ? rows[rows.length - 1]!.at : start,
      resolvedAt,
    },
    whySentence: compose(`fixtures.whySentence.${spec.id}`, spec.whySentence),
    features: spec.features,
    stagePath: buildStagePath(spec, start),
    velocityWindow: spec.velocityWindow,
    accounts: {
      actorUid: hashUid(spec.actorUid, MOCK_SALT),
      targetUid: hashUid(spec.targetUid, MOCK_SALT),
    },
    // Nothing has been designated: a designation is made at filing, and the
    // actor is the one value this must never default to.
    reportedSubjectUid: null,
    reviewerConfirmedT3: spec.tier === "T3",
    proposal: null,
    // Fixtures score every pair, so the model's tier is the pair's tier except
    // where a reviewer produced T3, which the model cannot (rule 6).
    modelTier: spec.tier === "T3" ? "T2" : spec.tier,
    actor: {
      hashedUid: hashUid(spec.actorUid, MOCK_SALT),
      band: spec.actorBand,
      ...spec.actor,
    },
    priorCases: spec.priorCases.map((prior) => ({
      ...prior,
      decidedAt: new Date(now.getTime() - 26 * HOUR),
    })),
    policy: {
      tier: spec.tier,
      criteria:
        spec.policyCriteria === null
          ? null
          : compose(`fixtures.policy.${spec.id}`, spec.policyCriteria),
      editedAt: spec.policyCriteria === null ? null : new Date(now.getTime() - 13 * 24 * HOUR),
      editedBy: spec.policyCriteria === null ? null : "M. Osei",
    },
    versions: { ...VERSIONS },
    // Five minutes after the pair's window opened, so a fixture pair's score
    // time tracks its age. It used to be five minutes before now for every
    // pair, whatever its age, which made every window filter and every
    // score-to-decision latency built on it meaningless.
    scoredAt: new Date(start.getTime() + Math.min(5, spec.openedMinutesAgo) * MINUTE),
    auditSeq,
    humanViewedAt,
    timeline,
  };
}

const AUDIT_FILLER: AuditKind[] = [
  "event.ingested",
  "score.assigned",
  "bundle.exported",
  "retention.deleted",
  "lexicon.updated",
  "customer.violation",
];

async function buildAuditChain(
  pairs: PairSpec[],
  now: Date,
): Promise<{
  log: AuditLog;
  store: MemoryAuditStore;
  entries: AuditEntry[];
  seqByPair: Map<string, number>;
}> {
  const store = new MemoryAuditStore();
  const log = new AuditLog(store, MOCK_AUDIT_SECRET);
  const random = mulberry32(0x4f2a91c7);
  const seqByPair = new Map<string, number>();

  const total = 40;
  for (let i = 0; i < total; i += 1) {
    const ts = new Date(now.getTime() - (total - i) * 7 * MINUTE);
    if (i < pairs.length) {
      const spec = pairs[i]!;
      const entry = await log.append({
        kind: "score.assigned",
        customerId: MOCK_CUSTOMER_ID,
        ts,
        payload: {
          pairId: spec.id,
          tier: spec.tier,
          criticalSignals: spec.criticalSignals,
          modelVersion: VERSIONS.modelVersion,
          lexiconVersion: VERSIONS.lexiconVersion,
          fusionVersion: VERSIONS.fusionVersion,
          soleAutomatedBasis: spec.soleAutomatedBasis,
        },
      });
      seqByPair.set(spec.id, entry.seq);
      continue;
    }
    const kind = AUDIT_FILLER[Math.floor(random() * AUDIT_FILLER.length)]!;
    await log.append({
      kind,
      customerId: MOCK_CUSTOMER_ID,
      ts,
      payload: {
        note: `fixture entry ${i + 1}`,
        pairId: pairs[Math.floor(random() * pairs.length)]!.id,
        lexiconVersion: VERSIONS.lexiconVersion,
      },
    });
  }

  const entries = await store.read(1);
  return { log, store, entries, seqByPair };
}

function buildReviews(now: Date, seqByPair: Map<string, number>): ReviewRecord[] {
  return [
    {
      id: "rvw_c5e1_propose",
      pairId: "pair_c5e1",
      shortId: "c5e1",
      reviewerId: "rev_mock",
      reviewerName: "A. Rivera",
      decision: "report",
      reasonCode: "propose.online_enticement",
      reasonLabel: "Online enticement of a child for sexual acts",
      priorTier: "T2",
      modelTier: "T2",
      resultTier: "T2",
      minutesSpent: 17,
      viewedExcerptCount: 4,
      notes: {
        timeline:
          "Image solicitation at 00:00, media event at 00:06, payment demand at 00:09.",
        outsideContext: "Two other pairs from this account in the same window.",
        recommendation: "Apply the action this server configured and preserve the excerpts.",
      },
      state: "upheld",
      parentReviewId: null,
      createdAt: new Date(now.getTime() - 3 * 24 * HOUR),
      retentionDeadline: new Date(now.getTime() + 362 * 24 * HOUR),
      auditSeq: seqByPair.get("pair_c5e1") ?? null,
    },
    {
      id: "rvw_c5e1_uphold",
      pairId: "pair_c5e1",
      shortId: "c5e1",
      reviewerId: "rev_mo",
      reviewerName: "M. Osei",
      decision: "report",
      reasonCode: "propose.online_enticement",
      reasonLabel: "Online enticement of a child for sexual acts",
      priorTier: "T2",
      modelTier: "T2",
      resultTier: "T3",
      minutesSpent: 9,
      viewedExcerptCount: 5,
      notes: {
        timeline: "Independent read reached the same ordered pattern.",
        outsideContext: null,
        recommendation: "Report drafted for the operator to file.",
      },
      state: "upheld",
      parentReviewId: "rvw_c5e1_propose",
      createdAt: new Date(now.getTime() - 3 * 24 * HOUR + 40 * MINUTE),
      retentionDeadline: new Date(now.getTime() + 362 * 24 * HOUR),
      auditSeq: seqByPair.get("pair_c5e1") ?? null,
    },
    {
      id: "rvw_91c7_propose",
      pairId: "pair_91c7",
      shortId: "91c7",
      reviewerId: "rev_mo",
      reviewerName: "M. Osei",
      decision: "report",
      reasonCode: "propose.online_enticement",
      reasonLabel: "Online enticement of a child for sexual acts",
      priorTier: "T2",
      modelTier: "T2",
      resultTier: "T2",
      minutesSpent: 22,
      viewedExcerptCount: 6,
      notes: {
        timeline:
          "Migration ask 9 minutes after first contact, and the younger account named the app it moved to.",
        outsideContext: null,
        recommendation: "Preserve the excerpts while a second reviewer reads them.",
      },
      state: "proposed",
      parentReviewId: null,
      createdAt: new Date(now.getTime() - 95 * MINUTE),
      retentionDeadline: new Date(now.getTime() + 27 * 24 * HOUR),
      auditSeq: seqByPair.get("pair_91c7") ?? null,
    },
    {
      id: "rvw_7d40_dismiss",
      pairId: "pair_7d40",
      shortId: "7d40",
      reviewerId: "rev_mock",
      reviewerName: "A. Rivera",
      decision: "dismiss",
      reasonCode: "dismiss.lexicon_false_positive",
      reasonLabel: "Lexicon false positive",
      priorTier: "T1",
      modelTier: "T1",
      resultTier: "T0",
      minutesSpent: 1,
      viewedExcerptCount: 2,
      notes: {
        timeline: "Two same-band accounts swapped usernames.",
        outsideContext: null,
        recommendation: null,
      },
      state: "recorded",
      parentReviewId: null,
      createdAt: new Date(now.getTime() - 26 * HOUR),
      retentionDeadline: new Date(now.getTime() - 2 * HOUR),
      auditSeq: seqByPair.get("pair_7d40") ?? null,
    },
  ];
}

function buildGuilds(now: Date): GuildConfigView[] {
  return [
    {
      guildId: "742118990011223344",
      customerId: MOCK_CUSTOMER_ID,
      modChannelId: "742118990011223999",
      roleBands: { "742118990011224001": "A13_15", "742118990011224002": "A16_17" },
      trustedRoleIds: ["742118990011224003"],
      defaultBand: "A13_15",
      defaultBandProvenance: "platform_default",
      autoTimeoutOnT2: false,
      autoTimeoutMinutes: 60,
      excludedChannelIds: ["742118990011224100"],
      enabled: true,
      updatedAt: new Date(now.getTime() - 2 * 24 * HOUR),
    },
    {
      guildId: "742118990055667788",
      customerId: MOCK_CUSTOMER_ID,
      modChannelId: null,
      roleBands: {},
      trustedRoleIds: [],
      defaultBand: "A13_15",
      defaultBandProvenance: "platform_default",
      autoTimeoutOnT2: false,
      autoTimeoutMinutes: 60,
      excludedChannelIds: [],
      enabled: false,
      updatedAt: new Date(now.getTime() - 9 * 24 * HOUR),
    },
  ];
}

let cached: Promise<MockData> | null = null;

async function build(): Promise<MockData> {
  const now = new Date();
  const pairSpecs = specs();
  const { log, store, entries, seqByPair } = await buildAuditChain(pairSpecs, now);
  const pairs = pairSpecs.map((spec) => buildPair(spec, now, seqByPair.get(spec.id) ?? null));
  const reviews = buildReviews(now, seqByPair);
  linkProposals(pairs, reviews);

  return {
    customer: {
      customerId: MOCK_CUSTOMER_ID,
      name: MOCK_CUSTOMER_NAME,
      jurisdictionCountry: "US",
      jurisdictionSubdivision: "TX",
      legalBasis: "operator_authority",
      crossCustomerOptIn: false,
      lexiconExtension: {
        version: "northwood-1",
        migration: ["hop on vc", "add my alt"],
      },
      // A guild owner who has done the local work and none of the NCMEC
      // registration, which is the ordinary state and the one worth rendering:
      // the console has to be readable when the report side is empty.
      timezone: "America/Chicago",
      ncmecProviderName: null,
      ncmecEspId: null,
      contactOnFile: false,
      credentialsOnFile: false,
      endToEndEncrypted: false,
    },
    pairs,
    reviews,
    guilds: buildGuilds(now),
    auditLog: log,
    auditStore: store,
    auditEntries: entries,
    activeSeats: 2,
    now,
  };
}

/**
 * Hangs each unanswered proposal on its pair.
 *
 * The database branch does this with one query keyed on `state: "proposed"`.
 * Fixtures build the pairs before the reviews, so the link is made here rather
 * than duplicating the state machine in a spec field: a proposal is a review
 * row in both branches, and there is one place that decides what "open" means.
 */
function linkProposals(pairs: MockPair[], reviews: ReviewRecord[]): void {
  for (const review of reviews) {
    if (review.state !== "proposed") continue;
    const pair = pairs.find((p) => p.queue.pairId === review.pairId);
    if (!pair) continue;
    const proposal = {
      reviewId: review.id,
      proposerReviewerId: review.reviewerId,
      proposerName: review.reviewerName,
      reasonLabel: review.reasonLabel,
      proposedAt: review.createdAt,
      // The mock session is A. Rivera, so a proposal from M. Osei is one this
      // seat answers rather than one it withdraws.
      mine: review.reviewerId === MOCK_REVIEWER.id,
    };
    pair.queue.proposal = proposal;
    pair.proposal = proposal;
  }
}

/** Memoized, so mutations from a mock decision are visible to the next read. */
export function getMockData(): Promise<MockData> {
  if (!cached) cached = build();
  return cached;
}

/** Test hook. Rebuilds the fixture set from the seed. */
export function resetMockData(): void {
  cached = null;
}

/**
 * The one line of the conversation the queue row carries.
 *
 * Not the worst thing said. Threat and sextortion language is collapsed behind
 * an explicit reveal on the case page, and lifting it onto a list somebody
 * scans six of would undo that for no gain: a reviewer deciding whether to open
 * a case does not need the threat, they need to recognise the move.
 *
 * So this takes the earliest line that carries a signal and is not collapsed,
 * which in practice is the supervision probe or the migration ask, the two
 * moves that make the shape recognisable. Null when the excerpts are gone under
 * retention, or when every signal-bearing line on the case is collapsed.
 */
function queueExcerpt(rows: TimelineRow[]): QueueExcerpt | null {
  const order = ["none", "contact", "trust", "probe", "migrate", "sexualize", "coerce"];
  const candidates = rows.filter(
    (row) => row.collapsed === null && row.media === null && row.signals.length > 0 && row.text,
  );
  // The furthest along, not the first: the row's job is to show how far this
  // went, and a contact-stage pleasantry shows nothing.
  const candidate = candidates.reduce<TimelineRow | null>((best, row) => {
    if (!best) return row;
    return order.indexOf(row.stage ?? "none") >= order.indexOf(best.stage ?? "none") ? row : best;
  }, null);
  if (!candidate?.text) return null;
  return {
    text: candidate.text,
    from: candidate.speaker === "t" ? "older" : "younger",
  };
}
