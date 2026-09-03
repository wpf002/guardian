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

const ZERO_WIDTH = /[​-‏‪-‮⁠-⁯﻿­]/;

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

    if (ZERO_WIDTH.test(ch)) continue;

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

  let buf = characterPass(text, lexicon.emoji, replacements);
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
