import type { Lexicon } from "./lexicon.js";

/**
 * Normalization layer (DESIGN.md 6.5). Coded language is the documented failure
 * mode of fine-tuned encoders, so this runs before tokenization and before any
 * lexicon match.
 *
 * Every transform keeps an index map back to the original string. Detectors
 * match on the normalized text but quote the original, so a reviewer sees what
 * was actually written and never a machine-rewritten version of it.
 */

export interface NormalizedText {
  /** The text as submitted. Excerpts must come from here. */
  original: string;
  /** Lowercased, de-obfuscated form used for matching. */
  normalized: string;
  /** `normalized` with every non-alphanumeric removed. Catches "s n a p" and "s.n.a.p". */
  compact: string;
  /** normalized[i] came from original[normalizedMap[i]]. */
  normalizedMap: number[];
  /** compact[i] came from original[compactMap[i]]. */
  compactMap: number[];
  /** What the layer rewrote, for the audit trail and for lexicon mining. */
  replacements: Array<{ from: string; to: string; kind: "emoji" | "leet" | "confusable" }>;
}

const ZERO_WIDTH = /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\u00ad]/;

/**
 * Variation selectors choose an emoji's text or emoji presentation and carry no
 * meaning of their own. They matter here because the character pass walks one
 * code point at a time, so a lexicon key written with one (U+2708 U+FE0F for
 * the plane) could never match and the entry was silently dead.
 */
const VARIATION_SELECTOR = /[︎️]/;

/** Strip the selectors so a key written either way resolves to the same entry. */
function withoutVariationSelectors(value: string): string {
  return value.replace(/[︎️]/g, "");
}

/**
 * Emoji keys are indexed by their selector-free form once per lexicon, rather
 * than per message. A key that reduces to an existing one does not overwrite it.
 */
const emojiIndexCache = new WeakMap<Record<string, string>, Record<string, string>>();

function indexEmoji(emoji: Record<string, string>): Record<string, string> {
  const cached = emojiIndexCache.get(emoji);
  if (cached) return cached;
  const index: Record<string, string> = {};
  for (const [key, value] of Object.entries(emoji)) {
    const bare = withoutVariationSelectors(key);
    if (bare.length === 0) continue;
    index[bare] ??= value;
  }
  emojiIndexCache.set(emoji, index);
  return index;
}

/** Cyrillic and Greek lookalikes are the cheapest filter evasion there is. */
const CONFUSABLES: Record<string, string> = {
  а: "a", в: "b", с: "c", е: "e", н: "h", к: "k", м: "m", о: "o", р: "p", ѕ: "s",
  т: "t", у: "y", х: "x", і: "i", ј: "j", ԁ: "d", ɡ: "g", ο: "o", ε: "e", ρ: "p",
  τ: "t", ι: "i", κ: "k", ν: "v", α: "a",
};

interface Buffered {
  out: string;
  map: number[];
}

function push(buf: Buffered, text: string, originIndex: number): void {
  for (const ch of text) {
    buf.out += ch;
    buf.map.push(originIndex);
  }
}

/**
 * Pass 1: character level. Strips invisibles and diacritics, folds confusables,
 * lowercases, and expands emoji from the lexicon into their plain word.
 */
function characterPass(
  original: string,
  emoji: Record<string, string>,
  replacements: NormalizedText["replacements"],
): Buffered {
  const buf: Buffered = { out: "", map: [] };
  const chars = [...original];

  // Byte offset of each code point, so the map points into the original string.
  const offsets: number[] = [];
  let offset = 0;
  for (const ch of chars) {
    offsets.push(offset);
    offset += ch.length;
  }

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const at = offsets[i]!;

    if (ZERO_WIDTH.test(ch) || VARIATION_SELECTOR.test(ch)) continue;

    const mapped = emoji[ch];
    if (mapped !== undefined) {
      // Pad so an emoji cannot glue two words together.
      push(buf, ` ${mapped} `, at);
      replacements.push({ from: ch, to: mapped, kind: "emoji" });
      continue;
    }

    const lower = ch.toLowerCase();
    const folded = CONFUSABLES[lower];
    if (folded !== undefined) {
      push(buf, folded, at);
      replacements.push({ from: ch, to: folded, kind: "confusable" });
      continue;
    }

    // NFKD then drop combining marks: "ẹ" becomes "e", "①" becomes "1".
    const decomposed = lower.normalize("NFKD").replace(/\p{M}/gu, "");
    if (decomposed === "") continue;
    push(buf, decomposed, at);
  }

  return buf;
}

/** Pass 2: collapse runs of 3+ identical characters down to 2 ("nuuuudes"). */
function collapseRuns(buf: Buffered): Buffered {
  const out: Buffered = { out: "", map: [] };
  let run = 0;
  let prev = "";
  for (let i = 0; i < buf.out.length; i++) {
    const ch = buf.out[i]!;
    run = ch === prev ? run + 1 : 0;
    prev = ch;
    if (run >= 2 && /[a-z]/.test(ch)) continue;
    out.out += ch;
    out.map.push(buf.map[i]!);
  }
  return out;
}

/**
 * Pass 3: multi-character leet substitutions from the lexicon. Applied longest
 * first so "d1sc0rd" wins over "1" style single-character rules.
 */
function leetPass(
  buf: Buffered,
  leet: Record<string, string>,
  replacements: NormalizedText["replacements"],
): Buffered {
  const entries = Object.entries(leet)
    .map(([from, to]) => [from.toLowerCase(), to.toLowerCase()] as const)
    .sort((a, b) => b[0].length - a[0].length);
  if (entries.length === 0) return buf;

  const out: Buffered = { out: "", map: [] };
  let i = 0;
  outer: while (i < buf.out.length) {
    for (const [from, to] of entries) {
      if (from.length === 0) continue;
      if (buf.out.startsWith(from, i)) {
        push(out, to, buf.map[i]!);
        replacements.push({ from, to, kind: "leet" });
        i += from.length;
        continue outer;
      }
    }
    out.out += buf.out[i]!;
    out.map.push(buf.map[i]!);
    i += 1;
  }
  return out;
}

/** Pass 4: collapse whitespace runs so phrase matching is not thrown by formatting. */
function collapseWhitespace(buf: Buffered): Buffered {
  const out: Buffered = { out: "", map: [] };
  let pendingSpace = false;
  for (let i = 0; i < buf.out.length; i++) {
    const ch = buf.out[i]!;
    if (/\s/.test(ch)) {
      pendingSpace = out.out.length > 0;
      continue;
    }
    if (pendingSpace) {
      out.out += " ";
      out.map.push(buf.map[i]!);
      pendingSpace = false;
    }
    out.out += ch;
    out.map.push(buf.map[i]!);
  }
  return out;
}

export function normalize(
  text: string,
  lexicon: Pick<Lexicon, "emoji" | "leet">,
): NormalizedText {
  const replacements: NormalizedText["replacements"] = [];

  let buf = characterPass(text, indexEmoji(lexicon.emoji), replacements);
  buf = collapseRuns(buf);
  buf = leetPass(buf, lexicon.leet, replacements);
  buf = collapseWhitespace(buf);

  const compact: Buffered = { out: "", map: [] };
  for (let i = 0; i < buf.out.length; i++) {
    const ch = buf.out[i]!;
    if (!/[a-z0-9]/.test(ch)) continue;
    compact.out += ch;
    compact.map.push(buf.map[i]!);
  }

  return {
    original: text,
    normalized: buf.out,
    compact: compact.out,
    normalizedMap: buf.map,
    compactMap: compact.map,
    replacements,
  };
}

/**
 * Quote the original text around a match found in the normalized form.
 * Bounded so an evidence excerpt never becomes a transcript dump.
 */
export function excerptFromNormalized(
  n: NormalizedText,
  start: number,
  length: number,
  pad = 40,
  max = 280,
): string {
  const map = n.normalizedMap;
  if (map.length === 0) return "";
  const from = map[Math.min(start, map.length - 1)] ?? 0;
  const endIdx = Math.min(start + Math.max(length, 1) - 1, map.length - 1);
  const to = (map[endIdx] ?? from) + 1;
  const lo = Math.max(0, from - pad);
  const hi = Math.min(n.original.length, to + pad);
  return n.original.slice(lo, Math.min(hi, lo + max));
}

/** Same, for a match found in the compact form. */
export function excerptFromCompact(
  n: NormalizedText,
  start: number,
  length: number,
  pad = 40,
  max = 280,
): string {
  const map = n.compactMap;
  if (map.length === 0) return "";
  const from = map[Math.min(start, map.length - 1)] ?? 0;
  const endIdx = Math.min(start + Math.max(length, 1) - 1, map.length - 1);
  const to = (map[endIdx] ?? from) + 1;
  const lo = Math.max(0, from - pad);
  const hi = Math.min(n.original.length, to + pad);
  return n.original.slice(lo, Math.min(hi, lo + max));
}

/* -------------------------------------------------------------------------- */
/* Reversed text                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Reverse the characters of each whitespace-delimited token, keeping the tokens
 * where they are. Exported for the tests that pin the index arithmetic.
 *
 * Index-exact: reversing within a token is a permutation of that token's
 * positions, so an offset map built alongside it still points at the original
 * characters and an excerpt still quotes what was actually written.
 */
export function reverseTokens(text: string, map?: readonly number[]): {
  text: string;
  map: number[];
} {
  return rewriteTokens(text, map, () => true);
}

/** Reverse only the tokens `shouldReverse` selects, by their stripped form. */
function rewriteTokens(
  text: string,
  map: readonly number[] | undefined,
  shouldReverse: (reversedAndStripped: string) => boolean,
): { text: string; map: number[] } {
  const out: string[] = [];
  const outMap: number[] = [];
  let token: string[] = [];
  let tokenMap: number[] = [];

  const flush = (): void => {
    const raw = token.join("");
    // Only the alphanumeric core is reversed, and the punctuation around it
    // stays where it was written. "margelet," is a word somebody typed and then
    // a comma, so the reading is "telegram," and not ",telegram": a leading
    // comma would sit inside a phrase match that expects a word boundary.
    let start = 0;
    let end = raw.length;
    while (start < end && !/[a-z0-9]/.test(raw[start]!)) start += 1;
    while (end > start && !/[a-z0-9]/.test(raw[end - 1]!)) end -= 1;
    const core = raw.slice(start, end);

    if (core.length > 0 && shouldReverse(reverseString(core))) {
      for (let i = 0; i < start; i++) push(i);
      for (let i = end - 1; i >= start; i--) push(i);
      for (let i = end; i < raw.length; i++) push(i);
    } else {
      for (let i = 0; i < raw.length; i++) push(i);
    }
    token = [];
    tokenMap = [];
  };

  function push(i: number): void {
    out.push(token[i]!);
    outMap.push(tokenMap[i] ?? -1);
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const at = map?.[i] ?? i;
    if (/\s/.test(ch)) {
      flush();
      out.push(ch);
      outMap.push(at);
    } else {
      token.push(ch);
      tokenMap.push(at);
    }
  }
  flush();
  return { text: out.join(""), map: outMap };
}

function reverseString(value: string): string {
  return [...value].reverse().join("");
}

/**
 * A reversed reading of an already-normalized message, or null when reversing
 * surfaces nothing the forward reading did not.
 *
 * Only the tokens that need reversing are reversed, and a token needs reversing
 * only when it is a platform name backwards and is not one forwards. That is
 * what the evasion actually looks like: "add me on drocsid", "margelet, add me
 * there", one word written backwards inside a sentence that still reads left to
 * right, because it has to stay readable by the person it is aimed at. Reversing
 * the rest of the sentence with it would destroy the phrase the detectors match
 * on, which is the difference between reading "telegram, add me there" and
 * reading "telegram, dda em ereht".
 *
 * The gate is deliberately narrow. Reversing every message and running the full
 * detector over both readings would double the work on ordinary traffic and
 * would eventually match something by accident, and an accidental match here is
 * a case in a reviewer's queue. Palindromes like "kik" need no reversal and
 * return null: the forward reading already matched.
 */
export function reversedReading(
  n: NormalizedText,
  platforms: readonly string[],
): NormalizedText | null {
  const names = new Set(platforms.map((p) => p.toLowerCase()));
  const forwardTokens = new Set(n.normalized.split(/\s+/).map(stripEdges).filter(Boolean));

  let surfaced = false;
  const rewritten = rewriteTokens(n.normalized, n.normalizedMap, (reversedStripped) => {
    if (reversedStripped.length < 3 || !names.has(reversedStripped)) return false;
    // That name is already in the message the right way round, so this token is
    // a palindrome of it and the forward reading has it covered.
    if (forwardTokens.has(reversedStripped)) return false;
    surfaced = true;
    return true;
  });
  if (!surfaced) return null;

  const compact: Buffered = { out: "", map: [] };
  for (let i = 0; i < rewritten.text.length; i++) {
    const ch = rewritten.text[i]!;
    if (!/[a-z0-9]/.test(ch)) continue;
    compact.out += ch;
    compact.map.push(rewritten.map[i]!);
  }

  return {
    original: n.original,
    normalized: rewritten.text,
    compact: compact.out,
    normalizedMap: rewritten.map,
    compactMap: compact.map,
    // The replacements belong to the forward reading. A reader of this one is
    // told it was reversed, which is the rewrite that matters here.
    replacements: n.replacements,
  };
}

function stripEdges(token: string): string {
  return token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}
