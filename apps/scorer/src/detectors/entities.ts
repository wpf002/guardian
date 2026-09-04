import type { Lexicon, NormalizedText } from "@guardian/schema";
import { excerptFromCompact, excerptFromNormalized } from "@guardian/schema";

/**
 * Entity extraction over the normalized text. Every match reports where it was
 * found so the pair scorer can quote the original message rather than a
 * rewritten one.
 */

export interface Match {
  /** The lexicon phrase or regex source that fired. */
  matched: string;
  /** Original text around the match, bounded. */
  excerpt: string;
  /** Which form matched. `compact` means the writer spaced or punctuated it out. */
  form: "normalized" | "compact";
}

function compactOf(phrase: string): string {
  return phrase.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Find the first occurrence of any phrase. Checks the normalized form first,
 * then the compact form, which catches "s n a p c h a t" and "s.n.a.p".
 * Short phrases are only checked in the normalized form, because a three
 * character compact needle matches far too much.
 */
export function findPhrases(n: NormalizedText, phrases: readonly string[]): Match[] {
  const out: Match[] = [];
  const seen = new Set<string>();

  for (const phrase of phrases) {
    const needle = phrase.toLowerCase();
    if (needle.length === 0 || seen.has(needle)) continue;

    const at = n.normalized.indexOf(needle);
    if (at !== -1) {
      seen.add(needle);
      out.push({
        matched: phrase,
        excerpt: excerptFromNormalized(n, at, needle.length),
        form: "normalized",
      });
      continue;
    }

    const compactNeedle = compactOf(phrase);
    if (compactNeedle.length < 6) continue;
    const cat = n.compact.indexOf(compactNeedle);
    if (cat !== -1) {
      seen.add(needle);
      out.push({
        matched: phrase,
        excerpt: excerptFromCompact(n, cat, compactNeedle.length),
        form: "compact",
      });
    }
  }

  return out;
}

export function findPatterns(n: NormalizedText, patterns: readonly string[]): Match[] {
  const out: Match[] = [];
  for (const source of patterns) {
    let re: RegExp;
    try {
      re = new RegExp(source, "gi");
    } catch {
      // A bad operator-supplied pattern must not take the worker down.
      continue;
    }
    const match = re.exec(n.normalized);
    if (match) {
      out.push({
        matched: source,
        excerpt: excerptFromNormalized(n, match.index, match[0].length),
        form: "normalized",
      });
    }
  }
  return out;
}

/** Payment handles and wallet addresses. Feeds the payment-after-media join. */
export function findPaymentHandles(n: NormalizedText, lex: Lexicon): Match[] {
  return findPatterns(n, lex.payment_handle_patterns);
}

/**
 * A named platform plus a handle in the same message is the migration ask in
 * its most concrete form: not "we should talk elsewhere" but "here is where".
 */
export function findHandoffs(n: NormalizedText, lex: Lexicon): Match[] {
  const platformHits = findPhrases(n, lex.platforms);
  if (platformHits.length === 0) return [];
  const handles = findPatterns(n, lex.handle_patterns);
  if (handles.length === 0) return [];
  return [
    {
      matched: `${platformHits[0]!.matched} + handle`,
      excerpt: handles[0]!.excerpt || platformHits[0]!.excerpt,
      form: handles[0]!.form,
    },
  ];
}

/** Currency amounts, used to separate "want some robux" from "send me $200". */
export function findAmounts(n: NormalizedText): Match[] {
  return findPatterns(n, ["\\$\\s?\\d{2,6}\\b", "\\b\\d{2,6}\\s?(dollars|usd|bucks)\\b"]);
}

/**
 * A platform name plus a movement verb is a migration ask even when the exact
 * phrase is not in the list: "talk to me on telegram" and "t e l e g r a m
 * instead" both mean the same thing. Checking the compact form is what catches
 * the spaced-out spelling.
 */
const MOVE_VERBS = [
  "add me",
  "add my",
  "talk",
  "chat",
  "message me",
  "msg me",
  "dm",
  "pm",
  "hit me",
  "find me",
  "go to",
  "move to",
  "switch to",
  "instead",
  "over there",
  "on there",
];

export function findPlatformMove(n: NormalizedText, lex: Lexicon): Match[] {
  const hasVerb = MOVE_VERBS.some((v) => n.normalized.includes(v));
  if (!hasVerb) return [];

  for (const platform of lex.platforms) {
    const needle = platform.toLowerCase();
    const at = n.normalized.indexOf(needle);
    if (at !== -1) {
      return [
        {
          matched: `move to ${platform}`,
          excerpt: excerptFromNormalized(n, at, needle.length),
          form: "normalized",
        },
      ];
    }
    const compactNeedle = compactOf(platform);
    if (compactNeedle.length < 4) continue;
    const cat = n.compact.indexOf(compactNeedle);
    if (cat !== -1) {
      return [
        {
          matched: `move to ${platform}`,
          excerpt: excerptFromCompact(n, cat, compactNeedle.length),
          form: "compact",
        },
      ];
    }
  }
  return [];
}

export interface PaymentEntity {
  match: Match;
  /** Which of the three ways it was recognised, for the reviewer and the eval harness. */
  via: "handle" | "demand_phrase" | "platform_and_amount" | "platform_and_verb";
  amounts: string[];
}

/**
 * A payment entity is a named rail plus an ask. A wallet address or an explicit
 * demand phrase is enough on its own; a rail name alone is not, because "i got
 * robux on cashapp" is ordinary chat in a game community.
 */
export function findPaymentEntity(n: NormalizedText, lex: Lexicon): PaymentEntity | null {
  const amounts = findAmounts(n).map((a) => a.excerpt.slice(0, 40));

  const handles = findPaymentHandles(n, lex);
  if (handles.length > 0) return { match: handles[0]!, via: "handle", amounts };

  const demands = findPhrases(n, lex.payment_demand);
  if (demands.length > 0) return { match: demands[0]!, via: "demand_phrase", amounts };

  const rails = findPhrases(n, lex.payment_platforms);
  if (rails.length === 0) return null;

  if (amounts.length > 0) return { match: rails[0]!, via: "platform_and_amount", amounts };

  const verbs = findPhrases(n, lex.payment_verbs);
  if (verbs.length > 0) return { match: rails[0]!, via: "platform_and_verb", amounts };

  return null;
}

export interface CoercionDirective {
  match: Match;
  /** Which half of the class fired, for the reviewer and the eval harness. */
  via: "self_harm_directive" | "mark_directive";
  /** A demand for proof of compliance in the same message. */
  complianceDemand: boolean;
  /** The proof demand, when one was present. */
  demandMatched: string | null;
}

/** A clause of the normalized text, with where it starts in that text. */
interface Clause {
  text: string;
  start: number;
}

/**
 * Split on sentence and clause punctuation. A support phrase in one clause
 * must not veto a directive in another: "are you ok? now carve my name into
 * your arm and send proof" is a directive with a greeting in front of it, and
 * a whole-message veto reads it as a wellness check.
 */
function clausesOf(normalized: string): Clause[] {
  const out: Clause[] = [];
  let start = 0;
  for (let i = 0; i <= normalized.length; i += 1) {
    const ch = normalized[i];
    if (i === normalized.length || ch === "." || ch === "," || ch === ";" || ch === ":" || ch === "!" || ch === "?" || ch === "\n") {
      const text = normalized.slice(start, i);
      if (text.trim().length > 0) out.push({ text, start });
      start = i + 1;
    }
  }
  return out.length > 0 ? out : [{ text: normalized, start: 0 }];
}

const WORD_CHAR = /[a-z0-9]/;

/**
 * Substring search that will not match inside a longer word. "cut sign" must
 * not fire on "shortcut signal", and the coercion lists are short enough that
 * a bare indexOf matches far too much.
 */
function indexOfWord(haystack: string, needle: string): number {
  if (needle.length === 0) return -1;
  for (let from = 0; from <= haystack.length - needle.length; ) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return -1;
    const before = at === 0 ? " " : haystack[at - 1]!;
    const after = at + needle.length >= haystack.length ? " " : haystack[at + needle.length]!;
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) return at;
    from = at + 1;
  }
  return -1;
}

interface ClauseHit {
  phrase: string;
  at: number;
}

/** The earliest of `phrases` in this clause, on word boundaries. */
function firstInClause(clause: string, phrases: readonly string[]): ClauseHit | null {
  let best: ClauseHit | null = null;
  for (const phrase of phrases) {
    const needle = phrase.toLowerCase();
    const at = indexOfWord(clause, needle);
    if (at !== -1 && (best === null || at < best.at)) best = { phrase, at };
  }
  return best;
}

function anyInClause(clause: string, phrases: readonly string[]): boolean {
  return firstInClause(clause, phrases) !== null;
}

/**
 * Every self-harm and mark phrase, in the order the detector prefers them. A
 * marker noun is not a directive on its own (see the class comment).
 */
function directiveInClause(
  clause: string,
  lex: Lexicon,
  demandPresent: boolean,
): { hit: ClauseHit; via: CoercionDirective["via"] } | null {
  const mark = firstInClause(clause, lex.coercion_mark_directive);
  if (mark) return { hit: mark, via: "mark_directive" };

  // A cutsign or a fansign is a noun, and the same noun is ordinary fandom
  // vocabulary. It becomes a demand only when the clause also carries the
  // other account's mark on it, or a demand for proof of compliance.
  const noun = firstInClause(clause, lex.coercion_mark_noun);
  if (noun && (demandPresent || anyInClause(clause, lex.coercion_mark_qualifier))) {
    return { hit: noun, via: "mark_directive" };
  }

  const harm = firstInClause(clause, lex.coercion_selfharm_directive);
  if (harm) return { hit: harm, via: "self_harm_directive" };

  return null;
}

/**
 * Non-financial coercion (ROADMAP S3). The 764, CVLT, Court and Greggy's Cult
 * pattern coerces self-harm, a cut of the other account's name into skin, or a
 * fansign, instead of money. Every sextortion heuristic in DESIGN.md 5 keys on
 * payment, so none of them fire on it.
 *
 * The whole difficulty is that the vocabulary is shared with a support
 * conversation, a disclosure, and ordinary fandom chat. DESIGN.md 5 states the
 * requirement for this row: it needs a directed imperative. That is what this
 * checks, rather than the presence of a phrase.
 *
 *   1. Direction. Only the actor's own messages reach the pair scorer, so what
 *      the other account says is never scored against them.
 *   2. Clause scope. Exemptions and blockers apply to the clause the directive
 *      sits in, not to the whole message. A support phrase in a different
 *      clause is not a licence to issue an instruction in this one.
 *   3. Imperative position. A directive preceded in its own clause by a
 *      negation ("dont starve yourself"), by reported speech ("he told me to
 *      cut deeper"), by first-person narration ("i had to cut my name into the
 *      wood"), or by an inquiry opener ("did you burn yourself") is not an
 *      instruction. It is a report of one, and the account quoting it is the
 *      one being instructed.
 *   4. Explicit exemption. A message that self-reports, that answers with
 *      support, or that asks after someone suppresses the signal outright
 *      rather than reducing its weight. Under-firing on a support conversation
 *      is the correct error here.
 *
 * The compact form (letters only, which catches "c u t   d e e p e r") loses
 * clause boundaries, so it keeps the older whole-message veto: any exempt
 * phrase or blocker anywhere in the message suppresses it.
 */
export function findCoercionDirective(n: NormalizedText, lex: Lexicon): CoercionDirective | null {
  const demands = findPhrases(n, lex.coercion_compliance_demand);
  const demandMatched = demands[0]?.matched ?? null;
  const demandPresent = demands.length > 0;

  let sawDirective = false;

  for (const clause of clausesOf(n.normalized)) {
    if (anyInClause(clause.text, lex.coercion_selfreport_exempt)) continue;
    if (anyInClause(clause.text, lex.coercion_support_exempt)) continue;
    if (anyInClause(clause.text, lex.coercion_inquiry_exempt)) continue;

    const found = directiveInClause(clause.text, lex, demandPresent);
    if (!found) continue;
    sawDirective = true;

    // Anything on the blocker list standing in front of the directive in the
    // same clause means this is not the imperative position.
    const prefix = clause.text.slice(0, found.hit.at);
    if (anyInClause(prefix, lex.coercion_directive_blocker)) continue;

    const at = clause.start + found.hit.at;
    return {
      match: {
        matched: found.hit.phrase,
        excerpt: excerptFromNormalized(n, at, found.hit.phrase.length),
        form: "normalized",
      },
      via: found.via,
      complianceDemand: demandPresent,
      demandMatched,
    };
  }

  // The compact form is for text the normalized form could not read at all,
  // the spaced-out and punctuated-out spellings. A directive that the
  // normalized pass saw and suppressed stays suppressed: reaching for the
  // compact form there would hand every exemption back through a side door.
  if (sawDirective) return null;
  return compactCoercionDirective(n, lex, demandPresent, demandMatched);
}

/**
 * The spaced-out and punctuated-out spelling. Clause boundaries do not survive
 * compaction, so the exemptions and the blockers apply to the whole message
 * here, which is the conservative reading.
 */
function compactCoercionDirective(
  n: NormalizedText,
  lex: Lexicon,
  demandPresent: boolean,
  demandMatched: string | null,
): CoercionDirective | null {
  const compact = n.compact;
  if (compact.length === 0) return null;

  // Suppression lists are read down to three characters here. Compaction
  // throws away the clause boundaries that carry the meaning, so the safe
  // reading is the one that suppresses more, not less.
  for (const list of [
    lex.coercion_selfreport_exempt,
    lex.coercion_support_exempt,
    lex.coercion_inquiry_exempt,
    lex.coercion_directive_blocker,
  ]) {
    if (compactHit(compact, list, 3) !== null) return null;
  }

  for (const [list, via] of [
    [lex.coercion_mark_directive, "mark_directive"],
    [lex.coercion_selfharm_directive, "self_harm_directive"],
  ] as const) {
    const hit = compactHit(compact, list);
    if (hit) {
      return {
        match: {
          matched: hit.phrase,
          excerpt: excerptFromCompact(n, hit.at, compactOf(hit.phrase).length),
          form: "compact",
        },
        via,
        complianceDemand: demandPresent,
        demandMatched,
      };
    }
  }

  return null;
}

/** Compact-form lookup. Needles under `minLength` characters match far too much. */
function compactHit(
  compact: string,
  phrases: readonly string[],
  minLength = 6,
): ClauseHit | null {
  for (const phrase of phrases) {
    const needle = compactOf(phrase);
    if (needle.length < minLength) continue;
    const at = compact.indexOf(needle);
    if (at !== -1) return { phrase, at };
  }
  return null;
}
