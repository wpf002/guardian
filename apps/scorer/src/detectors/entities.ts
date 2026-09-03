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
