import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Versioned script corpora for near-duplicate matching. Text only, offender
 * threat messages only. Never a dataset that could contain CSAM
 * (CLAUDE.md, external models and data).
 */

export const scriptCorpusSchema = z.object({
  version: z.string(),
  notes: z.string().optional(),
  scripts: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      text: z.string().min(1),
    }),
  ),
});
export type ScriptCorpus = z.infer<typeof scriptCorpusSchema>;

const here = dirname(fileURLToPath(import.meta.url));
export const CORPUS_DIR = join(here, "..", "corpus");

const cache = new Map<string, ScriptCorpus>();

export function availableCorpora(): string[] {
  return readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

export function loadScriptCorpus(version = "sextortion-v1"): ScriptCorpus {
  const cached = cache.get(version);
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(join(CORPUS_DIR, `${version}.json`), "utf8"));
  const parsed = scriptCorpusSchema.parse(raw);
  cache.set(version, parsed);
  return parsed;
}
