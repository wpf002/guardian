import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Versioned lexicon (DESIGN.md 6.5). Operators extend it per platform; the
 * merge is recorded in the version string so a score row can be reproduced.
 */

export const lexiconSchema = z.object({
  version: z.string(),
  notes: z.string().optional(),
  emoji: z.record(z.string(), z.string()).default({}),
  leet: z.record(z.string(), z.string()).default({}),
  platforms: z.array(z.string()).default([]),
  migration_ask: z.array(z.string()).default([]),
  supervision_probe: z.array(z.string()).default([]),
  secrecy: z.array(z.string()).default([]),
  economic_bait: z.array(z.string()).default([]),
  payment_platforms: z.array(z.string()).default([]),
  payment_verbs: z.array(z.string()).default([]),
  payment_demand: z.array(z.string()).default([]),
  age_relationship_framing: z.array(z.string()).default([]),
  image_solicitation: z.array(z.string()).default([]),
  threat_templates: z.array(z.string()).default([]),
  countdown_patterns: z.array(z.string()).default([]),
  meetup_logistics: z.array(z.string()).default([]),
  trafficking_recruitment: z.array(z.string()).default([]),
  // Non-financial coercion (ROADMAP S3). Added in v2; v1 loads with empty lists.
  coercion_selfharm_directive: z.array(z.string()).default([]),
  coercion_mark_directive: z.array(z.string()).default([]),
  /** Marker nouns. Not a directive alone; needs a qualifier or a demand beside it. */
  coercion_mark_noun: z.array(z.string()).default([]),
  /** What turns a marker noun into a demand: the other account's mark on it. */
  coercion_mark_qualifier: z.array(z.string()).default([]),
  coercion_compliance_demand: z.array(z.string()).default([]),
  coercion_selfreport_exempt: z.array(z.string()).default([]),
  coercion_support_exempt: z.array(z.string()).default([]),
  coercion_inquiry_exempt: z.array(z.string()).default([]),
  /**
   * Words that, standing in front of a directive in the same clause, mean the
   * clause reports, asks about or negates the instruction rather than issuing
   * it. A suppression list, so it is not customer-extendable.
   */
  coercion_directive_blocker: z.array(z.string()).default([]),
  payment_handle_patterns: z.array(z.string()).default([]),
  handle_patterns: z.array(z.string()).default([]),
});

export type Lexicon = z.infer<typeof lexiconSchema>;

/**
 * The phrase lists a customer extension may add to. Excludes maps and regex
 * sources, and excludes every suppression list: the merge only ever adds
 * entries, and adding to an exemption or a blocker list blinds the detector
 * for that customer, which is the one thing the merge contract forbids.
 */
export const PHRASE_FIELDS = [
  "platforms",
  "migration_ask",
  "supervision_probe",
  "secrecy",
  "economic_bait",
  "payment_platforms",
  "payment_verbs",
  "payment_demand",
  "age_relationship_framing",
  "image_solicitation",
  "threat_templates",
  "meetup_logistics",
  "trafficking_recruitment",
  "coercion_selfharm_directive",
  "coercion_mark_directive",
  "coercion_mark_noun",
  "coercion_mark_qualifier",
  "coercion_compliance_demand",
] as const;
export type PhraseField = (typeof PHRASE_FIELDS)[number];

const here = dirname(fileURLToPath(import.meta.url));
/** dist/ and src/ both sit one level under the package root. */
export const LEXICON_DIR = join(here, "..", "lexicon");

const cache = new Map<string, Lexicon>();

/**
 * Sorted oldest first. The comparison is numeric on the digits, not
 * lexicographic, so v10 sorts after v9 rather than between v1 and v2. A score
 * row that names an older version keeps resolving to that file forever; the
 * files are append-only.
 */
export function availableLexiconVersions(): string[] {
  return readdirSync(LEXICON_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort(compareVersions);
}

function compareVersions(a: string, b: string): number {
  const na = Number(a.replace(/^v/, ""));
  const nb = Number(b.replace(/^v/, ""));
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

export function latestLexiconVersion(): string {
  const versions = availableLexiconVersions();
  if (versions.length === 0) throw new Error(`no lexicon files in ${LEXICON_DIR}`);
  return versions[versions.length - 1]!;
}

export function loadLexicon(version = latestLexiconVersion()): Lexicon {
  const cached = cache.get(version);
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(join(LEXICON_DIR, `${version}.json`), "utf8"));
  const parsed = lexiconSchema.parse(raw);
  cache.set(version, parsed);
  return parsed;
}

/**
 * Merge a per-customer extension over the base lexicon. Extensions only add
 * phrases and mappings; they cannot remove a base entry, because a customer
 * should not be able to blind the detector by shipping an empty list.
 */
export function mergeLexicon(base: Lexicon, extension: Partial<Lexicon>, label: string): Lexicon {
  const merged: Lexicon = { ...base, version: `${base.version}+${label}` };

  merged.emoji = { ...base.emoji, ...(extension.emoji ?? {}) };
  merged.leet = { ...base.leet, ...(extension.leet ?? {}) };

  for (const field of PHRASE_FIELDS) {
    merged[field] = dedupe([...base[field], ...(extension[field] ?? [])]);
  }
  merged.countdown_patterns = dedupe([
    ...base.countdown_patterns,
    ...(extension.countdown_patterns ?? []),
  ]);
  merged.payment_handle_patterns = dedupe([
    ...base.payment_handle_patterns,
    ...(extension.payment_handle_patterns ?? []),
  ]);
  merged.handle_patterns = dedupe([...base.handle_patterns, ...(extension.handle_patterns ?? [])]);

  return merged;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}
