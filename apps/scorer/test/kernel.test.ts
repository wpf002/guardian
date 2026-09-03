import { describe, expect, it } from "vitest";
import { runConversation, type Line } from "./helpers.js";

/**
 * These are the shapes from DESIGN.md section 3, written as conversations.
 * The controls matter as much as the positives: teen-to-teen romance and kids
 * swapping usernames must not reach the review queue.
 */

const groomingLadder: Line[] = [
  { from: "actor", text: "hey nice build in that game", at: 0 },
  { from: "target", text: "thanks lol", at: 1 },
  { from: "actor", text: "what do you like to play? i can send you some robux if you want", at: 3 },
  { from: "target", text: "omg really", at: 4 },
  { from: "actor", text: "yeah. are your parents home right now? do they check your phone?", at: 8 },
  { from: "target", text: "no theyre at work", at: 9 },
  { from: "actor", text: "cool. add me on 👻 my snap is ryan_xx99, easier to talk there", at: 12 },
  { from: "target", text: "ok", at: 13 },
  { from: "actor", text: "dont tell anyone we talk ok, our secret", at: 15 },
];

const teenRomance: Line[] = [
  { from: "actor", text: "hey you were funny in vc last night", at: 0 },
  { from: "target", text: "haha thanks", at: 2 },
  { from: "actor", text: "u single? lol", at: 5 },
  { from: "target", text: "maybe why", at: 6 },
  { from: "actor", text: "add me on snap, my user is jayden.k", at: 9 },
  { from: "target", text: "added you", at: 10 },
  { from: "actor", text: "wanna be my girlfriend", at: 30 },
  { from: "target", text: "yes lol", at: 33 },
];

const handleSwap: Line[] = [
  { from: "actor", text: "whats your snap", at: 0 },
  { from: "target", text: "its miamia03 whats urs", at: 1 },
  { from: "actor", text: "added you", at: 2 },
  { from: "target", text: "cool", at: 3 },
];

const sextortion: Line[] = [
  { from: "actor", text: "hey you look cute, wanna trade pics", at: 0 },
  { from: "target", text: "idk", at: 2 },
  { from: "actor", text: "ill send mine first", at: 3 },
  { from: "target", media: { sha256: "b".repeat(64) }, at: 6 },
  { from: "actor", text: "send me 200 on cashapp right now or i send this to everyone you know", at: 9 },
];

describe("relationship grooming trajectory", () => {
  it("reaches the review queue on probe followed by migration", async () => {
    const run = await runConversation(groomingLadder, {
      actorBand: "A21_PLUS",
      targetBand: "A9_12",
    });
    expect(run.peakTier).toBe("T2");
    expect(run.last?.result.pair.stagesHit).toContain("probe");
    expect(run.last?.result.pair.stagesHit).toContain("migrate");
    expect(run.last?.result.rationale.join(" ")).toContain("probe to migrate");
  });

  it("scores lower when the same words pass between two 14 year olds", async () => {
    const adult = await runConversation(groomingLadder, {
      actorBand: "A21_PLUS",
      targetBand: "A9_12",
    });
    const peers = await runConversation(groomingLadder, {
      actorBand: "A13_15",
      targetBand: "A13_15",
    });
    expect(peers.last!.result.fusedScore).toBeLessThan(adult.last!.result.fusedScore);
  });
});

describe("controls", () => {
  // DESIGN.md section 10: teen romance control, T2 rate at or below 0.1% of pairs.
  it("keeps same band teen romance out of the review queue", async () => {
    const run = await runConversation(teenRomance, {
      actorBand: "A13_15",
      targetBand: "A13_15",
    });
    expect(run.peakTier).not.toBe("T2");
  });

  it("keeps kids swapping usernames out of the review queue", async () => {
    const run = await runConversation(handleSwap, {
      actorBand: "A13_15",
      targetBand: "A13_15",
    });
    expect(run.peakTier).toBe("T0");
  });

  it("damps a customer designated moderator without silencing them", async () => {
    const plain = await runConversation(groomingLadder, {
      actorBand: "A21_PLUS",
      targetBand: "A9_12",
    });
    const mod = await runConversation(groomingLadder, {
      actorBand: "A21_PLUS",
      targetBand: "A9_12",
      role: "moderator",
    });
    expect(mod.last!.result.fusedScore).toBeLessThanOrEqual(plain.last!.result.fusedScore);
    expect(mod.peakTier).toBe("T2");
  });
});

describe("financial sextortion", () => {
  it("forces a review on a payment demand shortly after inbound media", async () => {
    const run = await runConversation(sextortion, {
      actorBand: "UNKNOWN",
      targetBand: "A16_17",
    });
    expect(run.peakTier).toBe("T2");
    expect(run.last?.result.criticalSignals).toContain("payment_after_media");
  });

  it("matches a paraphrased extortion script through the minhash index", async () => {
    const paraphrased: Line[] = [
      { from: "target", text: "please stop", at: 0 },
      {
        from: "actor",
        text: "i have all of your friends and family list. if you do not send me the money i will send your pictures to everybody that you know. you have one hour to decide",
        at: 1,
      },
    ];
    const run = await runConversation(paraphrased, {
      actorBand: "UNKNOWN",
      targetBand: "A16_17",
    });
    expect(run.last?.result.criticalSignals).toContain("threat_template");
    const scriptHit = run.last?.result.pair.signals.find((s) => s.matched?.startsWith("script:"));
    expect(scriptHit).toBeDefined();
  });
});

describe("critical signal gating", () => {
  it("treats meetup talk between peers as a signal but not a forcing one", async () => {
    const lines: Line[] = [
      { from: "actor", text: "wanna meet up at the mall after school", at: 0 },
      { from: "target", text: "sure", at: 1 },
    ];
    const peers = await runConversation(lines, { actorBand: "A13_15", targetBand: "A13_15" });
    expect(peers.last?.result.criticalSignals).not.toContain("meetup_logistics");

    const adult = await runConversation(lines, { actorBand: "A21_PLUS", targetBand: "A13_15" });
    expect(adult.last?.result.criticalSignals).toContain("meetup_logistics");
    expect(adult.peakTier).toBe("T2");
  });

  it("forces a review on an operator supplied known csam verdict", async () => {
    const lines: Line[] = [
      { from: "actor", text: "look at this", media: { sha256: "c".repeat(64), knownCsamVerdict: "match" }, at: 0 },
    ];
    const run = await runConversation(lines, { actorBand: "A21_PLUS", targetBand: "A13_15" });
    expect(run.last?.result.criticalSignals).toContain("known_csam_hash");
    expect(run.peakTier).toBe("T2");
  });
});

describe("evasion", () => {
  it("still sees the migration ask through emoji and leet encoding", async () => {
    const plain: Line[] = [
      { from: "actor", text: "are your parents home", at: 0 },
      { from: "target", text: "no", at: 1 },
      { from: "actor", text: "add me on snapchat", at: 5 },
    ];
    const encoded: Line[] = [
      { from: "actor", text: "are your p@rents home", at: 0 },
      { from: "target", text: "no", at: 1 },
      { from: "actor", text: "add me on 👻", at: 5 },
    ];
    const a = await runConversation(plain, { actorBand: "A21_PLUS", targetBand: "A9_12" });
    const b = await runConversation(encoded, { actorBand: "A21_PLUS", targetBand: "A9_12" });
    expect(b.last!.result.pair.stagesHit).toEqual(a.last!.result.pair.stagesHit);
    expect(b.peakTier).toBe(a.peakTier);
  });

  it("sees a spaced out platform handoff", async () => {
    const lines: Line[] = [
      { from: "actor", text: "are your parents home", at: 0 },
      { from: "target", text: "nope", at: 1 },
      { from: "actor", text: "talk to me on t e l e g r a m instead", at: 4 },
    ];
    const run = await runConversation(lines, { actorBand: "A21_PLUS", targetBand: "A9_12" });
    expect(run.last?.result.pair.stagesHit).toContain("migrate");
  });
});

describe("hard rules", () => {
  it("never emits T3 from the model", async () => {
    const worst: Line[] = [
      ...groomingLadder,
      { from: "actor", text: "send pics or i will ruin your life. you have 24 hours", at: 20 },
      { from: "actor", text: "ill pick you up after school, whats your address", at: 25 },
    ];
    const run = await runConversation(worst, { actorBand: "A21_PLUS", targetBand: "A9_12" });
    const tiers = run.results.map((r) => r.result.tier);
    expect(tiers).not.toContain("T3");
    expect(run.last?.result.producedBy).toBe("model");
  });

  it("records the version triple on every score", async () => {
    const run = await runConversation(groomingLadder, { actorBand: "A21_PLUS", targetBand: "A9_12" });
    for (const r of run.results) {
      expect(r.result.versions.modelVersion).toBeTruthy();
      expect(r.result.versions.lexiconVersion).toBeTruthy();
      expect(r.result.versions.fusionVersion).toBeTruthy();
    }
  });

  it("does not score the child's own messages against the child", async () => {
    const run = await runConversation(groomingLadder, { actorBand: "A21_PLUS", targetBand: "A9_12" });
    const childAsActor = run.results.filter((r) => r.result.pair.actorUid === "target-hash");
    for (const r of childAsActor) {
      expect(r.result.tier).toBe("T0");
    }
  });
});
