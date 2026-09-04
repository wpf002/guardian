/**
 * Signals, as the case view lists them.
 *
 * A signal is a thing that fired on a row, not a thing about a person. This
 * builds the list from the timeline the reviewer can read, so every entry can
 * be traced to a message they can open, and attaches the lexicon entry that
 * rewrote the token where the normalizer left one.
 *
 * The fusion weight is matched to a signal by name and is often absent, because
 * a fusion term is not the same object as a lexicon hit. Absent prints as
 * absent rather than as zero.
 */

import type { CaseDetail, TimelineState } from "@/lib/data/types";

export interface SignalLexiconEntry {
  normalized: string;
  original: string;
  entry: string;
  lexiconVersion: string;
}

export interface CaseSignal {
  kind: string;
  /** The kind in words. Never an adjective, and never attached to a person. */
  label: string;
  occurrences: number;
  critical: boolean;
  /** Null when no fusion term carries this signal's name on its own. */
  weight: number | null;
  firstAt: Date | null;
  lexicon: SignalLexiconEntry[];
}

export function signalLabel(kind: string): string {
  return kind.replace(/_/g, " ");
}

/**
 * One entry per signal kind, ordered by the fusion weight where there is one
 * and by first appearance where there is not.
 */
export function buildSignalList(detail: CaseDetail, timeline: TimelineState): CaseSignal[] {
  const byKind = new Map<string, CaseSignal>();
  const critical = new Set(detail.queue.criticalSignals);
  const weights = new Map(
    detail.features.map((feature) => [feature.label.toLowerCase(), feature.weight]),
  );

  function ensure(kind: string): CaseSignal {
    const existing = byKind.get(kind);
    if (existing) return existing;
    const label = signalLabel(kind);
    const created: CaseSignal = {
      kind,
      label,
      occurrences: 0,
      critical: critical.has(kind),
      weight: weights.get(label) ?? null,
      firstAt: null,
      lexicon: [],
    };
    byKind.set(kind, created);
    return created;
  }

  if (timeline.state === "ready") {
    for (const row of timeline.rows) {
      for (const kind of row.signals) {
        const signal = ensure(kind);
        signal.occurrences += 1;
        if (signal.firstAt === null || row.at < signal.firstAt) signal.firstAt = row.at;
        for (const hit of row.normalizations) {
          const already = signal.lexicon.some((entry) => entry.entry === hit.entry);
          if (!already) signal.lexicon.push({ ...hit });
        }
      }
    }
  }

  // A critical signal that fired outside the excerpts still has to be listed,
  // because the tier rests on it and an absent row is not an absent signal.
  for (const kind of detail.queue.criticalSignals) ensure(kind);

  return [...byKind.values()].sort((a, b) => {
    if (a.critical !== b.critical) return a.critical ? -1 : 1;
    const aw = a.weight ?? -1;
    const bw = b.weight ?? -1;
    if (aw !== bw) return bw - aw;
    return a.label.localeCompare(b.label);
  });
}

/** How many excerpts this reviewer has already been recorded as reading. */
export function readExcerptCount(timeline: TimelineState): number {
  if (timeline.state !== "ready") return 0;
  return timeline.rows.filter((row) => row.viewedByHuman).length;
}

export function excerptTotal(timeline: TimelineState): number {
  if (timeline.state !== "ready") return 0;
  return timeline.rows.filter((row) => row.media === null).length;
}
