import { describe, expect, it } from "vitest";
import { Kernel } from "../src/kernel.js";
import { MemoryKernelStore } from "../src/store.js";
import { buildEvidenceBundle } from "../src/bundle.js";
import { makeEvent, runConversation, T0, type Line } from "./helpers.js";

/**
 * The seams between the pieces four owners built separately. Each unit is
 * tested where it lives; this file asserts that the kernel actually calls it
 * and that the value reaches the row, which is the class of gap a unit test on
 * either side cannot see.
 */

const VICTIM = "victim-hash";

/** One flagged message from a distinct older account to the same target. */
function convergingLine(sourceIndex: number, minutes: number) {
  return makeEvent(
    { from: "actor", text: "are your parents home right now", at: minutes },
    sourceIndex,
    { actorBand: "A21_PLUS", targetBand: "A9_12", actorUid: `source-${sourceIndex}`, targetUid: VICTIM },
  );
}

/** A benign message from a distinct older account to the same target. */
function benignLine(sourceIndex: number, minutes: number) {
  return makeEvent(
    { from: "actor", text: "gg that was a good round", at: minutes },
    sourceIndex,
    { actorBand: "A21_PLUS", targetBand: "A9_12", actorUid: `fan-${sourceIndex}`, targetUid: VICTIM },
  );
}

describe("fan-IN reaches the kernel", () => {
  it("accrues the inbound half of the graph and applies it to the pair term", async () => {
    const store = new MemoryKernelStore();
    const kernel = new Kernel({ store });

    for (let i = 0; i < 5; i += 1) await kernel.score(convergingLine(i, i * 10));

    const scored = await kernel.score(
      makeEvent(
        { from: "actor", text: "add me on snap, my user is ryan_xx99", at: 90 },
        99,
        { actorBand: "A21_PLUS", targetBand: "A9_12", actorUid: "source-9", targetUid: VICTIM },
      ),
    );

    expect(scored).not.toBeNull();
    expect(scored!.result.fanIn?.converging).toBe(true);
    expect(scored!.result.fanIn!.convergingSources).toBeGreaterThanOrEqual(3);
    expect(scored!.result.fanIn!.multiplier).toBeGreaterThan(1);
  });

  it("does not tier a popular account, because the multiplier needs a pair signal to multiply", async () => {
    const store = new MemoryKernelStore();
    const kernel = new Kernel({ store });

    for (let i = 0; i < 40; i += 1) await kernel.score(benignLine(i, i * 5));

    const scored = await kernel.score(
      makeEvent({ from: "actor", text: "nice one", at: 300 }, 400, {
        actorBand: "A21_PLUS",
        targetBand: "A9_12",
        actorUid: "fan-40",
        targetUid: VICTIM,
      }),
    );

    expect(scored!.result.tier).toBe("T0");
    expect(scored!.result.fusedScore).toBe(0);
  });

  it("does not count a redelivered message twice", async () => {
    const store = new MemoryKernelStore();
    const kernel = new Kernel({ store });

    const event = convergingLine(1, 0);
    await kernel.score(event);
    await kernel.score(event);

    const state = await store.getActor(event.customerId, VICTIM);
    expect(state?.inbound).toHaveLength(1);
  });
});

describe("compliance fields on the row", () => {
  const ladder: Line[] = [
    { from: "actor", text: "hey nice build in that game", at: 0 },
    { from: "actor", text: "are your parents home right now? do they check your phone?", at: 8 },
    { from: "actor", text: "add me on 👻 my snap is ryan_xx99", at: 12 },
  ];

  it("records soleAutomatedBasis false when the tier rests on conversational facts", async () => {
    const run = await runConversation(ladder, { actorBand: "A21_PLUS", targetBand: "A9_12" });
    expect(run.last?.result.tier).not.toBe("T0");
    expect(run.last?.result.pair.signals.length).toBeGreaterThan(0);
    expect(run.last?.result.soleAutomatedBasis).toBe(false);
  });

  it("carries the posture, so a moderator is not handed an enforcement action against a child", async () => {
    const adult = await runConversation(ladder, { actorBand: "A21_PLUS", targetBand: "A9_12" });
    expect(adult.last?.result.suggestedPosture).toBe("enforcement");
    expect(adult.last?.result.supportReferral).toBeNull();

    const minor = await runConversation(ladder, { actorBand: "A13_15", targetBand: "A13_15" });
    expect(minor.last?.result.suggestedPosture).toBe("support");
    expect(minor.last?.result.supportReferral).toContain("Take It Down");
  });

  it("names the velocity window that carried the term", async () => {
    // The ladder is walked inside twelve minutes, so the window is the fast
    // one. Listing every value the field can take asserts nothing.
    const run = await runConversation(ladder, { actorBand: "A21_PLUS", targetBand: "A9_12" });
    expect(run.last?.result.velocityWindow).toBe("fast");
  });

  // A generated bundle can only ever say that nobody has read it. The
  // pair-level humanViewedAt and the reviewer id live on the Prisma row and are
  // written by a reviewer action, which is phase 2 (ROADMAP F-1), so there is
  // nothing on the bundle type to assert them against.
  it("marks every excerpt in a fresh bundle as read by nobody", () => {
    const bundle = buildEvidenceBundle({
      customerId: "cus_test",
      actorUid: "actor-hash",
      targetUid: VICTIM,
      tier: "T2",
      timeline: [
        {
          ts: new Date(T0),
          channel: "general",
          direction: "actor_to_target",
          text: "are your parents home",
          mediaSha256: null,
          knownCsamVerdict: null,
          stage: "probe",
          signals: ["supervision_probe"],
        },
      ],
      signals: [],
      versions: { modelVersion: "rules-v1", lexiconVersion: "v2", fusionVersion: "rules-v2" },
      provenance: [{ surface: "discord", sourceId: "guild-1" }],
      auditHead: "0".repeat(64),
    });

    expect(bundle.timeline.length).toBeGreaterThan(0);
    expect(bundle.timeline.every((row) => row.viewedByHuman === false)).toBe(true);
  });
});
