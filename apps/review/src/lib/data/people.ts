import { bandOrder, isMinorBand } from "@guardian/schema";
import type { QueueCase } from "./types";

/**
 * The same cases, grouped by the accounts in them.
 *
 * The console listed pairs. A pair is Guardian's unit, not a person's: a child
 * three separate accounts are working on appeared as three unrelated rows with
 * nothing tying them together, and the one fact that matters most about that
 * child, that it is three and not one, was on no screen anywhere.
 *
 * This reads the queue Guardian already produces and answers the two questions
 * a pair cannot. Who is being contacted, and by how many. And which account is
 * contacting several children.
 *
 * It is grouping, not new detection. Every conversation here came from the
 * kernel; nothing is inferred about a person, and no group is a finding. A
 * "child" here is an account whose recorded band is a minor band, which is a
 * claim of a known strength recorded on the row (rule 9), not a fact about
 * anybody's age.
 */

/** One conversation, from the point of view of one side of it. */
export interface Contact {
  pairId: string;
  /** The account at the other end. */
  uid: string;
  band: QueueCase["actorBand"];
  tier: QueueCase["tier"];
  patternClause: string;
  excerpt: QueueCase["excerpt"];
  criticalSignals: string[];
  stagesReached: number;
  channel: string | null;
  at: Date;
  targetSource: QueueCase["targetSource"];
  /**
   * The unanswered proposal on this conversation, when there is one.
   *
   * Carried whole rather than as a boolean: a second reviewer needs to know who
   * proposed it and when, and a row that only says "waiting" makes them open
   * the case to find out.
   */
  proposal: QueueCase["proposal"];
  unread: boolean;
}

/** An account being contacted, and everyone contacting it. */
export interface TargetedAccount {
  uid: string;
  band: QueueCase["targetBand"];
  /** Newest first. More than one is the fact this whole grouping exists for. */
  contacts: Contact[];
  /** Every channel any of these conversations happened in. */
  channels: string[];
  /** The most serious tier across the conversations. */
  tier: QueueCase["tier"];
  /** The newest conversation, which is what the list sorts on. */
  lastAt: Date;
  awaitingSecond: boolean;
  unread: boolean;
}

/** An account contacting others, and every account it has contacted. */
export interface ContactingAccount {
  uid: string;
  band: QueueCase["actorBand"];
  contacts: Contact[];
  /** How many of the accounts it contacted are in a minor band. */
  minorCount: number;
  tier: QueueCase["tier"];
  lastAt: Date;
}

const TIER_RANK = { T0: 0, T1: 1, T2: 2, T3: 3 } as const;

function worse(a: QueueCase["tier"], b: QueueCase["tier"]): QueueCase["tier"] {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

/**
 * Which side of the pair is the younger one.
 *
 * The kernel calls one side the actor and the other the target, and that is a
 * statement about who spoke, not about who is at risk. On most cases the actor
 * is the older account, but not on all of them: two accounts in the same band
 * produce a pair where neither is younger, and a child can be the actor. So
 * this compares the recorded bands rather than trusting the roles, and returns
 * null when the bands do not separate them.
 */
function younger(item: QueueCase): { child: Side; other: Side } | null {
  const a = bandOrder(item.actorBand.band);
  const t = bandOrder(item.targetBand.band);
  if (a === null || t === null || a === t) return null;
  const actorIsYounger = a < t;
  const child = actorIsYounger
    ? { uid: item.actorUid, band: item.actorBand }
    : { uid: item.targetUid, band: item.targetBand };
  if (!isMinorBand(child.band.band)) return null;
  const other = actorIsYounger
    ? { uid: item.targetUid, band: item.targetBand }
    : { uid: item.actorUid, band: item.actorBand };
  return { child, other };
}

interface Side {
  uid: string;
  band: QueueCase["actorBand"];
}

function contactFrom(item: QueueCase, other: Side): Contact {
  return {
    pairId: item.pairId,
    uid: other.uid,
    band: other.band,
    tier: item.tier,
    patternClause: item.patternClause,
    excerpt: item.excerpt,
    criticalSignals: item.criticalSignals,
    stagesReached: item.stagesReached,
    channel: item.channel,
    at: item.createdAt,
    targetSource: item.targetSource,
    proposal: item.proposal,
    unread: item.unread,
  };
}

/**
 * Accounts in a minor band that somebody older has been talking to.
 *
 * Sorted by how many accounts are contacting each one, then by how recent. A
 * child three accounts are working on goes above a child one account is, and
 * that ordering is the entire argument for this page existing.
 */
export function groupByTargetedAccount(cases: QueueCase[]): TargetedAccount[] {
  const byUid = new Map<string, TargetedAccount>();
  for (const item of cases) {
    const sides = younger(item);
    if (!sides) continue;
    const contact = contactFrom(item, sides.other);
    const existing = byUid.get(sides.child.uid);
    if (!existing) {
      byUid.set(sides.child.uid, {
        uid: sides.child.uid,
        band: sides.child.band,
        contacts: [contact],
        channels: item.channel ? [item.channel] : [],
        tier: item.tier,
        lastAt: item.createdAt,
        awaitingSecond: contact.proposal !== null,
        unread: contact.unread,
      });
      continue;
    }
    existing.contacts.push(contact);
    if (item.channel && !existing.channels.includes(item.channel)) {
      existing.channels.push(item.channel);
    }
    existing.tier = worse(existing.tier, item.tier);
    if (item.createdAt > existing.lastAt) existing.lastAt = item.createdAt;
    existing.awaitingSecond ||= contact.proposal !== null;
    existing.unread ||= contact.unread;
  }

  for (const account of byUid.values()) {
    account.contacts.sort((a, b) => b.at.getTime() - a.at.getTime());
  }
  return [...byUid.values()].sort(
    (a, b) =>
      Number(b.awaitingSecond) - Number(a.awaitingSecond) ||
      b.contacts.length - a.contacts.length ||
      TIER_RANK[b.tier] - TIER_RANK[a.tier] ||
      b.lastAt.getTime() - a.lastAt.getTime(),
  );
}

/**
 * The other direction: an older account and every account it has contacted.
 *
 * Sorted by how many of those are in a minor band. One conversation is a
 * conversation; the same approach made to five children in a week is the shape
 * the fan-out feature exists to see, and it is invisible on a list of pairs.
 */
export function groupByContactingAccount(cases: QueueCase[]): ContactingAccount[] {
  const byUid = new Map<string, ContactingAccount>();
  for (const item of cases) {
    const sides = younger(item);
    if (!sides) continue;
    const contact = contactFrom(item, sides.child);
    const existing = byUid.get(sides.other.uid);
    if (!existing) {
      byUid.set(sides.other.uid, {
        uid: sides.other.uid,
        band: sides.other.band,
        contacts: [contact],
        minorCount: 1,
        tier: item.tier,
        lastAt: item.createdAt,
      });
      continue;
    }
    existing.contacts.push(contact);
    existing.minorCount += 1;
    existing.tier = worse(existing.tier, item.tier);
    if (item.createdAt > existing.lastAt) existing.lastAt = item.createdAt;
  }
  for (const account of byUid.values()) {
    account.contacts.sort((a, b) => b.at.getTime() - a.at.getTime());
  }
  return [...byUid.values()].sort(
    (a, b) =>
      b.minorCount - a.minorCount ||
      TIER_RANK[b.tier] - TIER_RANK[a.tier] ||
      b.lastAt.getTime() - a.lastAt.getTime(),
  );
}

/**
 * Conversations no grouping claims: neither side is recorded as younger, or
 * neither band is known. They are still real conversations somebody flagged,
 * and dropping them off the page because the ages did not separate would hide
 * exactly the case a bridged game chat produces, where both sides read UNKNOWN.
 */
export function ungrouped(cases: QueueCase[]): QueueCase[] {
  return cases.filter((item) => younger(item) === null);
}
