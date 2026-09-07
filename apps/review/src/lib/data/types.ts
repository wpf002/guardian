/**
 * View models the pages build against.
 *
 * These are deliberately not Prisma row types. A page renders a case, not a
 * row, and the mock fixtures have to satisfy the same shape as the database
 * without importing a generated client. Every field here is either a fact from
 * the pair row or a string that has already passed the wording guard.
 */

import type { AgeBand, ReviewDecision, Stage, Tier } from "@guardian/schema";

export type { AgeBand, ReviewDecision, Stage, Tier };

/** Speaker tags as the ML service puts them on the wire, so a reviewer reads what the model read. */
export type Speaker = "t" | "s1" | "s2";

export type BandProvenance =
  | "facial_estimate"
  | "government_id"
  | "os_bracket"
  | "server_role"
  | "platform_default"
  | "customer_declared"
  | "unknown";

/** A band with the two things that make it auditable later. */
export interface BandReading {
  band: AgeBand;
  /** Null means the source published no calibrated number. Never read null as zero. */
  confidence: number | null;
  provenance: BandProvenance;
}

/**
 * Claim ownership. The schema has no claim columns yet (DESIGN-UI 13.2 gap 1),
 * so a database read always returns "unclaimed" and only the fixtures produce
 * the other two states.
 */
export type ClaimState =
  | { state: "unclaimed" }
  | { state: "mine"; who: string; sinceMinutes: number }
  | { state: "other"; who: string; sinceMinutes: number };

export interface QueueFilters {
  /** "all" | "critical" | "unclaimed" | "breach" | "needs_second" */
  chip?: "all" | "critical" | "unclaimed" | "breach" | "needs_second";
  tier?: Tier[];
  limit?: number;
}

/** One queue row. Three lines, never four (DESIGN-UI 6). */
/**
 * A line of the conversation as the queue shows it.
 *
 * `from` is a side, not a person: "older" and "younger" are the two bands on
 * the pair, and the row never carries a name because there is never one to
 * carry (CLAUDE.md rule 8).
 */
export interface QueueExcerpt {
  text: string;
  from: "older" | "younger";
}

export interface QueueCase {
  pairId: string;
  /** Last four of the pair id. The header names the pair, never the people. */
  shortId: string;
  customerId: string;
  customerName: string;
  channel: string | null;
  tier: Tier;
  criticalSignals: string[];
  /** A noun phrase naming the pattern. Passed through the wording guard. */
  patternClause: string;
  actorBand: BandReading;
  targetBand: BandReading;
  /** "actor in 3 pairs this week", "first case for this actor". A count, never a judgment. */
  actorContext: string;
  suggestedPosture: "enforcement" | "support" | null;
  soleAutomatedBasis: boolean;
  messageCount: number;
  spanHours: number;
  mediaEventCount: number;
  /**
   * One line of the conversation, for the queue row.
   *
   * The reviewer's only question at the queue is whether to open this case, and
   * a description of a conversation is a worse answer than a line of it. The
   * line is chosen server-side and it is never the worst thing said: threat and
   * sextortion language stays collapsed behind an explicit reveal on the case
   * page, so the queue takes the earliest recognisable move instead. Null when
   * the excerpts are gone under retention, or when every line on the case is a
   * collapsed span.
   */
  excerpt: QueueExcerpt | null;
  /** How many of the six stages were reached. The trajectory, as a count. */
  stagesReached: number;
  /** When the pair arrived. The row prints a clock time, not a countdown. */
  createdAt: Date;
  /** Null on T1: the card prints "no SLA (watch)" so the absence is a statement. */
  slaRemainingMinutes: number | null;
  claim: ClaimState;
  unread: boolean;
  updatedAt: Date;
  resolvedAt: Date | null;
}

export interface QueueSummary {
  partitionName: string;
  total: number;
  criticalCount: number;
  unclaimedCount: number;
  breachRiskCount: number;
  needsSecondCount: number;
  /** Null when nothing has ever arrived. Lets a reviewer tell empty from broken. */
  lastArrivalAt: Date | null;
}

export interface QueuePage {
  summary: QueueSummary;
  cases: QueueCase[];
}

/** One contributing feature, as a weight the case view draws as a short bar. */
export interface Feature {
  label: string;
  weight: number;
  critical: boolean;
}

/** The six-cell stage vector, in the order the stages were reached. */
export interface StagePoint {
  stage: Stage;
  reachedAt: Date | null;
  /** Hours since the previous reached stage. Null on the first one. */
  elapsedHoursFromPrevious: number | null;
}

export interface ActorContext {
  hashedUid: string;
  band: BandReading;
  accountAgeHours: number | null;
  pairsInWindow: number;
  fanOut7d: number;
  minorFanOut7d: number;
  /** Convergence on the receiving account (ROADMAP S1). Null when not persisted. */
  fanIn7d: number | null;
  altClusterSize: number;
  /** An elevated role is context for the reviewer, never a reason to lower a tier. */
  elevatedRole: string | null;
}

export interface PriorCase {
  pairId: string;
  shortId: string;
  decidedAt: Date;
  decision: ReviewDecision;
  resultTier: Tier;
  reasonLabel: string;
}

export interface OperatorPolicy {
  tier: Tier;
  criteria: string | null;
  editedAt: Date | null;
  editedBy: string | null;
}

export interface Versions {
  modelVersion: string;
  lexiconVersion: string;
  fusionVersion: string;
}

/** A collapsed span renders as its class and word count, never its content. */
export interface CollapsedSpan {
  spanClass: "explicit" | "threat" | "coercion" | "payment_coercion";
  wordCount: number;
}

/** A token the normalizer rewrote, with the original available on hover and on focus. */
export interface NormalizationHit {
  normalized: string;
  original: string;
  entry: string;
  lexiconVersion: string;
}

export interface MediaEvent {
  sha256: string;
  direction: "older_to_younger" | "younger_to_older";
  /** The operator's own scanner verdict. Guardian never runs one. */
  verdict: "match" | "no_match" | "not_run";
  viewedByOperatorHuman: boolean;
}

export interface TimelineRow {
  id: string;
  at: Date;
  speaker: Speaker;
  bandLabel: string;
  /** Null when the row is a media event or the excerpt was collapsed. */
  text: string | null;
  collapsed: CollapsedSpan | null;
  normalizations: NormalizationHit[];
  stage: Stage | null;
  /** Calibrated, to two decimals. Never a raw logit. */
  confidence: number | null;
  lowConfidence: boolean;
  signals: string[];
  media: MediaEvent | null;
  viewedByHuman: boolean;
  /**
   * Whether this excerpt came from an open channel, a group, or a private
   * message, as the customer stated it. Null means they did not say, and the
   * code reads that as private.
   *
   * The kernel has carried this since the compliance-provenance work and
   * nothing read it (ROADMAP P-9). It belongs in front of a reviewer for two
   * reasons: Regulation (EU) 2026/1881 treats private messaging differently
   * from an open channel, and a line said in a server everyone can read is a
   * different fact from the same line said in a DM.
   */
  channelVisibility: "public" | "private" | "group" | null;
  /** Hours of silence before this row, when the gap is worth a labelled spacer. */
  gapHoursBefore: number | null;
}

export type TimelineState =
  | { state: "ready"; rows: TimelineRow[]; messageCount: number; collapsedThirdParty: number }
  /** Excerpts deleted under retention. A normal outcome, not an error. */
  | { state: "expired"; deletedOn: Date | null }
  | { state: "empty" };

export interface CaseDetail {
  queue: QueueCase;
  /** One behavioural sentence, guard-checked at the data boundary. */
  whySentence: string;
  features: Feature[];
  stagePath: StagePoint[];
  velocityWindow: string | null;
  actor: ActorContext;
  /**
   * Both accounts on the pair, as salted hashes.
   *
   * The console used to carry only the actor's, which meant every surface that
   * had to name an account named that one. NCMEC displays the reported account
   * as the suspect, and the actor is whichever side the detectors scored, so a
   * draft built from the actor alone was Guardian designating a suspect
   * (CLAUDE.md rule 5). ROADMAP S4 is the reason it matters: the detectors fire
   * on minor-band accounts on purpose, so the actor is sometimes the child.
   */
  accounts: { actorUid: string; targetUid: string };
  /** The account a reviewer designated as the subject of a report, if any. */
  reportedSubjectUid: string | null;
  /**
   * Whether a recorded reviewer decision on THIS pair produced tier T3.
   *
   * The one fact rule 6 turns on, and it is not the pair's tier: the model
   * assigns T2 on its own, and a case sitting at T2 has had no decision at all.
   * The console used to draft a CyberTipline bundle at T2 or T3 and check only
   * that somebody had opened an excerpt, so an owner could export a federal
   * report built from a tier the model produced with no reviewer decision
   * behind it, let alone the two a T3 needs.
   */
  reviewerConfirmedT3: boolean;
  priorCases: PriorCase[];
  policy: OperatorPolicy;
  versions: Versions;
  scoredAt: Date;
  /** Chain reference. The provenance line links to /audit/[seq]. */
  auditSeq: number | null;
  humanViewedAt: Date | null;
}

/** One recorded decision, as /decisions and /decisions/[reviewId] render it. */
export interface ReviewRecord {
  id: string;
  pairId: string;
  shortId: string;
  reviewerId: string;
  reviewerName: string;
  decision: ReviewDecision;
  reasonCode: string;
  reasonLabel: string;
  modelTier: Tier;
  resultTier: Tier;
  minutesSpent: number | null;
  viewedExcerptCount: number | null;
  notes: {
    timeline: string | null;
    outsideContext: string | null;
    recommendation: string | null;
  };
  /** Set on a concurrence, an overturn or a reopen: the row this one answers. */
  parentReviewId: string | null;
  createdAt: Date;
  /** When the excerpts behind this decision are scheduled for deletion. */
  retentionDeadline: Date | null;
  auditSeq: number | null;
}

export interface DashboardSummary {
  customerId: string;
  customerName: string;
  windowDays: number;
  /** Counts of pairs, never of people. */
  pairsByTier: Record<Tier, number>;
  pairsDecided: number;
  sentToSecondReviewer: number;
  reportsDrafted: number;
  /** DESIGN.md 6.4 first-class metric. Aggregate, never per reviewer. */
  reviewerMinutesPer1kUsers: number | null;
  /**
   * Confirms and proposals as a share of the decisions on pairs the model put
   * at T2. Null below the stated n: "not enough decisions yet".
   */
  t2PositivePredictiveValue: number | null;
  /** Decisions on model-T2 pairs in the window, which is the ratio's denominator. */
  decisionsSampleSize: number;
  oldestProposalAgeHours: number | null;
  activeSeats: number;
  versions: Versions;
}

export interface GuildConfigView {
  guildId: string;
  customerId: string;
  modChannelId: string | null;
  roleBands: Record<string, AgeBand>;
  trustedRoleIds: string[];
  defaultBand: AgeBand;
  defaultBandProvenance: BandProvenance;
  autoTimeoutOnT2: boolean;
  autoTimeoutMinutes: number;
  excludedChannelIds: string[];
  enabled: boolean;
  updatedAt: Date;
}

export interface CustomerSettings {
  customerId: string;
  name: string;
  jurisdictionCountry: string | null;
  jurisdictionSubdivision: string | null;
  legalBasis: string | null;
  crossCustomerOptIn: boolean;
  lexiconExtension: Record<string, unknown> | null;
  /**
   * The reporting identity: who the operator is when a report is filed. All
   * nullable, because none of it exists before they register with NCMEC, and a
   * report built without it says so rather than guessing (ROADMAP P-2).
   */
  timezone: string | null;
  ncmecProviderName: string | null;
  ncmecEspId: string | null;
  /** Whether a named point of contact is on file. Never the details. */
  contactOnFile: boolean;
  /** Whether the operator's own NCMEC credentials are sealed on the row. */
  credentialsOnFile: boolean;
  /**
   * True when this customer's traffic is end to end encrypted, so Guardian sees
   * only what a client sent it. A gap in a trajectory is then expected rather
   * than a finding, and the case page says so (ROADMAP F-7).
   */
  endToEndEncrypted: boolean;
}

export interface AuditEntryView {
  seq: number;
  ts: Date;
  kind: string;
  customerId: string;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
}
