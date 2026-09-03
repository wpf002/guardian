import type { AgeBand, Event } from "@guardian/schema";
import { Kernel } from "../src/kernel.js";
import { MemoryKernelStore } from "../src/store.js";

export const T0 = new Date("2026-09-02T12:00:00Z").getTime();

export interface Line {
  from: "actor" | "target";
  text?: string;
  media?: { sha256: string; knownCsamVerdict?: "match" | "no_match" | "not_run" };
  /** Minutes after the conversation start. */
  at: number;
}

export interface ConversationOptions {
  actorBand: AgeBand;
  targetBand: AgeBand;
  actorUid?: string;
  targetUid?: string;
  customerId?: string;
  accountAgeHours?: number;
  role?: Event["actorRole"];
  channel?: string;
}

export function makeEvent(
  line: Line,
  index: number,
  opts: ConversationOptions,
): Event {
  const actorUid = opts.actorUid ?? "actor-hash";
  const targetUid = opts.targetUid ?? "target-hash";
  const fromActor = line.from === "actor";
  return {
    externalId: `m${index}`,
    customerId: opts.customerId ?? "cus_test",
    actorUid: fromActor ? actorUid : targetUid,
    targetUid: fromActor ? targetUid : actorUid,
    channel: opts.channel ?? "general",
    ts: new Date(T0 + line.at * 60_000),
    text: line.text ?? null,
    media: line.media
      ? {
          sha256: line.media.sha256,
          knownCsamVerdict: line.media.knownCsamVerdict ?? "not_run",
          kind: "image" as const,
        }
      : null,
    actorBand: fromActor ? opts.actorBand : opts.targetBand,
    targetBand: fromActor ? opts.targetBand : opts.actorBand,
    actorRole: fromActor ? (opts.role ?? "unknown") : "unknown",
    actorAccountAgeHours: fromActor ? (opts.accountAgeHours ?? null) : null,
    deviceHints: null,
    provenance: { surface: "discord", sourceId: "guild-1" },
    retention: "EPHEMERAL_24H" as const,
    expiresAt: new Date(T0 + 24 * 60 * 60 * 1000),
  };
}

/** Run a scripted conversation and return the last tier result for the pair. */
export async function runConversation(lines: Line[], opts: ConversationOptions) {
  const store = new MemoryKernelStore();
  const kernel = new Kernel({ store });
  const results = [];
  for (const [i, line] of lines.entries()) {
    const scored = await kernel.score(makeEvent(line, i, opts));
    if (scored) results.push(scored);
  }
  const actorResults = results.filter((r) => r.result.actor.actorUid === (opts.actorUid ?? "actor-hash"));
  return {
    kernel,
    store,
    results,
    last: actorResults[actorResults.length - 1] ?? null,
    peakTier: actorResults.reduce<string>((peak, r) => (r.result.tier > peak ? r.result.tier : peak), "T0"),
  };
}
