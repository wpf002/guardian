import { Kernel, MemoryKernelStore } from "@guardian/scorer";
import type { Event, Tier } from "@guardian/schema";
import { expiresAt, retentionForTier } from "@guardian/schema";
import type { Conversation } from "./generators.js";

/** Runs conversations through the kernel and records the peak tier per pair. */

export interface ConversationOutcome {
  id: string;
  label: Conversation["label"];
  positive: boolean;
  peakTier: Tier;
  /** Turns from conversation start until the first tier at or above T1. */
  messagesToT1: number | null;
  messagesToT2: number | null;
  criticalSignals: string[];
  stagesHit: string[];
  fusedScore: number;
}

const BASE_TS = Date.parse("2026-09-02T00:00:00Z");

export async function runConversations(
  conversations: Conversation[],
  kernelFactory: () => Kernel = () => new Kernel({ store: new MemoryKernelStore() }),
): Promise<ConversationOutcome[]> {
  const out: ConversationOutcome[] = [];

  for (const [index, conversation] of conversations.entries()) {
    // A fresh kernel per conversation keeps pairs independent, which is what a
    // per-pair metric needs. The fan-out test builds shared state on purpose.
    const kernel = kernelFactory();
    const actorUid = `actor-${conversation.id}`;
    const targetUid = `target-${conversation.id}`;

    let peakTier: Tier = "T0";
    let messagesToT1: number | null = null;
    let messagesToT2: number | null = null;
    let criticalSignals: string[] = [];
    let stagesHit: string[] = [];
    let fusedScore = 0;
    let sent = 0;

    for (const [i, turn] of conversation.turns.entries()) {
      const fromActor = turn.from === "actor";
      const event: Event = {
        externalId: `${conversation.id}-${i}`,
        customerId: "cus_eval",
        actorUid: fromActor ? actorUid : targetUid,
        targetUid: fromActor ? targetUid : actorUid,
        channel: `chan-${index % 8}`,
        ts: new Date(BASE_TS + turn.at * 60_000),
        text: turn.text,
        media: null,
        actorBand: fromActor ? conversation.actorBand : conversation.targetBand,
        targetBand: fromActor ? conversation.targetBand : conversation.actorBand,
        actorRole: "unknown",
        actorAccountAgeHours: null,
        deviceHints: null,
        provenance: { surface: "platform_sdk", sourceId: "eval" },
        retention: retentionForTier("T0"),
        expiresAt: expiresAt(retentionForTier("T0"), new Date(BASE_TS)) ?? new Date(),
      };

      const scored = await kernel.score(event);
      sent += 1;
      if (!scored || !fromActor) continue;

      const tier = scored.result.tier;
      if (tier !== "T0" && messagesToT1 === null) messagesToT1 = sent;
      if ((tier === "T2" || tier === "T3") && messagesToT2 === null) messagesToT2 = sent;
      if (tierRank(tier) > tierRank(peakTier)) peakTier = tier;
      if (scored.result.criticalSignals.length > 0) criticalSignals = scored.result.criticalSignals;
      stagesHit = scored.result.pair.stagesHit;
      fusedScore = Math.max(fusedScore, scored.result.fusedScore);
    }

    out.push({
      id: conversation.id,
      label: conversation.label,
      positive: conversation.positive,
      peakTier,
      messagesToT1,
      messagesToT2,
      criticalSignals,
      stagesHit,
      fusedScore,
    });
  }

  return out;
}

export function tierRank(tier: Tier): number {
  return { T0: 0, T1: 1, T2: 2, T3: 3 }[tier];
}

export interface ConfusionAt {
  tier: Tier;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  precision: number;
  recall: number;
}

export function confusionAt(outcomes: ConversationOutcome[], threshold: Tier): ConfusionAt {
  const min = tierRank(threshold);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;

  for (const o of outcomes) {
    const flagged = tierRank(o.peakTier) >= min;
    if (o.positive && flagged) tp++;
    else if (!o.positive && flagged) fp++;
    else if (o.positive && !flagged) fn++;
    else tn++;
  }

  return {
    tier: threshold,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    trueNegatives: tn,
    precision: tp + fp === 0 ? 0 : tp / (tp + fp),
    recall: tp + fn === 0 ? 0 : tp / (tp + fn),
  };
}

export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}
