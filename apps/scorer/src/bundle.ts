import { randomUUID } from "node:crypto";
import type {
  EvidenceBundle,
  Provenance,
  RetentionClass,
  SignalHit,
  SignalKind,
  Stage,
  Tier,
  Versions,
} from "@guardian/schema";
import { retentionForTier } from "@guardian/schema";

/**
 * Evidence bundle (DESIGN.md 7, 8). Text excerpts, hashes, timestamps and model
 * versions. No imagery, ever: the reviewer never sees an image and Guardian
 * never holds one. The bundle anchors to the audit chain head so the export can
 * be shown to have preceded any later edit.
 */

export interface TimelineInput {
  ts: Date;
  channel: string;
  direction: "actor_to_target" | "target_to_actor";
  text: string | null;
  mediaSha256: string | null;
  knownCsamVerdict: "match" | "no_match" | "not_run" | null;
  stage: Stage | null;
  signals: SignalKind[];
}

export interface BuildBundleInput {
  customerId: string;
  actorUid: string;
  targetUid: string;
  tier: Tier;
  timeline: TimelineInput[];
  signals: SignalHit[];
  versions: Versions;
  provenance: Provenance[];
  auditHead: string;
  now?: Date;
  /** Excerpt cap per message. Enough for context, not a transcript dump. */
  maxExcerpt?: number;
  retention?: RetentionClass;
}

export function buildEvidenceBundle(input: BuildBundleInput): EvidenceBundle {
  const maxExcerpt = input.maxExcerpt ?? 500;

  return {
    bundleId: `bdl_${randomUUID()}`,
    customerId: input.customerId,
    actorUid: input.actorUid,
    targetUid: input.targetUid,
    tier: input.tier,
    timeline: [...input.timeline]
      .sort((a, b) => a.ts.getTime() - b.ts.getTime())
      .map((row) => ({
        ts: row.ts,
        channel: row.channel,
        direction: row.direction,
        excerpt: row.text === null ? null : row.text.slice(0, maxExcerpt),
        mediaSha256: row.mediaSha256,
        knownCsamVerdict: row.knownCsamVerdict,
        stage: row.stage,
        signals: row.signals,
      })),
    signals: input.signals,
    versions: input.versions,
    provenance: dedupeProvenance(input.provenance),
    generatedAt: input.now ?? new Date(),
    retention: input.retention ?? retentionForTier(input.tier),
    auditHead: input.auditHead,
  };
}

function dedupeProvenance(items: Provenance[]): Provenance[] {
  const seen = new Set<string>();
  const out: Provenance[] = [];
  for (const p of items) {
    const key = `${p.surface}:${p.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/**
 * Human-readable summary for a mod channel or a reviewer card. Describes what
 * happened in the traffic and never characterises the person
 * (CLAUDE.md rule 5).
 */
export function summarizeBundle(bundle: EvidenceBundle, rationale: string[]): string {
  const window = bundle.timeline.length
    ? `${bundle.timeline[0]!.ts.toISOString()} to ${bundle.timeline[bundle.timeline.length - 1]!.ts.toISOString()}`
    : "no messages retained";
  const lines = [
    `Tier ${bundle.tier} on one conversation pair.`,
    `Window: ${window}.`,
    `Messages in bundle: ${bundle.timeline.length}. Signals recorded: ${bundle.signals.length}.`,
    ...rationale.map((r) => `- ${r}`),
    "This is a risk tier for human review, not a determination about any person.",
  ];
  return lines.join("\n");
}
