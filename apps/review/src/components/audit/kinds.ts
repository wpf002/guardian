import { AUDIT_KINDS, type AuditKind } from "@guardian/audit";

/**
 * What happened, in a sentence, for every kind the chain can hold.
 *
 * This is keyed off AUDIT_KINDS rather than a loose Record<string, string>, and
 * that is the whole point of the type. The map used to carry two keys that do
 * not exist, "report.submitted" and "config.updated", and to miss three that
 * do: event.ingested, event.rejected and report.filed. Every row of those three
 * rendered its raw machine name to a person, and event.ingested is the most
 * common row on the page, so most of the log read as source code. A loose
 * Record accepted that silently.
 *
 * Record<AuditKind, string> does not. Adding a kind to the chain now fails the
 * build until it has words here, and kinds.test.ts checks the same thing at
 * runtime for anything that reaches the page from a database rather than the
 * const.
 *
 * Each sentence names the actor and is in the past tense, because the log is a
 * record of things that already happened. No sentence names a person.
 */
export const KIND_WORDS: Record<AuditKind, string> = {
  "event.ingested": "A message was read",
  "event.rejected": "A message was refused",
  "score.assigned": "Guardian scored a conversation",
  "evidence.read": "A reviewer opened the messages",
  "review.decision": "A reviewer made a decision",
  "bundle.exported": "The evidence was downloaded",
  "report.filed": "A report went to NCMEC",
  "retention.deleted": "Old data was deleted on schedule",
  "customer.violation": "An incoming message broke a rule and was dropped",
  "lexicon.updated": "The phrase list changed",
  "delivery.result_dropped": "An alert went out twice",
};

/**
 * Words for a kind, including one that is not in this build.
 *
 * A chain read from a database can hold a kind written by a newer deployment.
 * That is the one case where the raw name is the honest answer, and it is
 * marked as such rather than printed bare as though it were English.
 */
export function kindWords(kind: string): string {
  return KIND_WORDS[kind as AuditKind] ?? `An event this version does not recognise (${kind})`;
}

/** Every kind the chain can write, for the filter, in the order it lists them. */
export const KIND_OPTIONS: { value: AuditKind; label: string }[] = AUDIT_KINDS.map((value) => ({
  value,
  label: KIND_WORDS[value],
}));

/**
 * The second line of a row: which conversation, and what came of it.
 *
 * Without it the log is twenty-five rows of eleven repeated sentences, and
 * three of them saying "Guardian scored a conversation" are indistinguishable
 * until somebody clicks each one. The payload already carries the pair and the
 * tier; this reads them and says nothing when they are absent.
 */
export function entryDetail(payload: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const pairId = payload.pairId;
  if (typeof pairId === "string" && pairId.length > 0) {
    parts.push(`Conversation ${pairId.slice(-4)}`);
  }
  const tier = payload.tier;
  if (typeof tier === "string" && tier in TIER_WORDS) {
    parts.push(TIER_WORDS[tier as keyof typeof TIER_WORDS]);
  }
  const deleted = payload.deleted;
  if (typeof deleted === "number") {
    parts.push(`${deleted} ${deleted === 1 ? "record" : "records"} removed`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * What a tier meant, not what it was called. "T2" is Guardian's word for it and
 * means nothing to the lawyer this page exists to be handed to.
 */
const TIER_WORDS = {
  T0: "nothing to act on",
  T1: "kept an eye on it",
  T2: "sent to a person",
  T3: "a person confirmed it",
} as const;
