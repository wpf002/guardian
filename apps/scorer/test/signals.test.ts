import { findAccusations, loadLexicon, mergeLexicon, normalize, PHRASE_FIELDS } from "@guardian/schema";
import { describe, expect, it } from "vitest";
import { findHandoffs, findPlatformMove } from "../src/detectors/entities.js";
import {
  emptyActorState,
  observeInbound,
  scoreFanIn,
  type ActorState,
  type FanInSignal,
} from "../src/actor.js";
import { detectMessage } from "../src/detectors/index.js";
import { fuse, SUPPORT_REFERRAL, suggestedPosture } from "../src/fusion.js";
import { applyMessage, emptyPairState, scorePair, type PairState } from "../src/pair.js";
import { Kernel } from "../src/kernel.js";
import { MemoryKernelStore } from "../src/store.js";
import { makeEvent, runConversation, type Line } from "./helpers.js";

/**
 * The four signals the case files produced (ROADMAP "New signal work").
 *
 *   S1 Fan-IN inversion, from Greggy's Cult (EDNY, indicted December 2025).
 *   S2 Two velocity windows, from EOGP (Webster et al. 2012) and Thorn 2025.
 *   S3 Non-financial coercion, from 764, CVLT, Court and Kaskar.
 *   S4 Victim-side posture, from Patchin and Hinduja (n=5,568).
 *
 * Every positive case here is paired with the control that would otherwise
 * burn a reviewer: the popular younger account, the slow but ordinary
 * conversation, and the support conversation about self-harm.
 */

const LEX = loadLexicon();
const NOW = new Date("2026-09-02T12:00:00Z");
const HOUR = 3600_000;
const DAY = 24 * HOUR;

function detect(text: string) {
  return detectMessage(text, {
    lexicon: LEX,
    actorBand: "A21_PLUS",
    targetBand: "A13_15",
  }).detections;
}

function coercionHit(text: string) {
  return detect(text).find((d) => d.kind === "coercion_nonfinancial") ?? null;
}

// ---------------------------------------------------------------------------
// S1 Fan-IN inversion
// ---------------------------------------------------------------------------

interface Source {
  uid: string;
  band: "A21_PLUS" | "A18_20" | "A13_15" | "A9_12";
  flagged: boolean;
}

function targetWithInbound(targetBand: ActorState["actorBand"], sources: Source[]): ActorState {
  let state = emptyActorState(targetBand);
  for (const [i, source] of sources.entries()) {
    state = observeInbound(state, {
      ts: new Date(NOW.getTime() - i * HOUR),
      sourceUid: source.uid,
      sourceBand: source.band,
      flagged: source.flagged,
    });
  }
  return state;
}

function olderFlagged(count: number): Source[] {
  return Array.from({ length: count }, (_, i) => ({
    uid: `adult-${i}`,
    band: "A21_PLUS" as const,
    flagged: true,
  }));
}

describe("S1 fan-IN inversion", () => {
  it("calls convergence when several older accounts carrying signal reach one younger account", () => {
    const signal = scoreFanIn(targetWithInbound("A13_15", olderFlagged(5)), { now: NOW });
    expect(signal.converging).toBe(true);
    expect(signal.convergingSources).toBe(5);
    expect(signal.multiplier).toBeGreaterThan(1);
    expect(signal.rationale.join(" ")).toContain("5 separate accounts");
  });

  it("stays neutral below the minimum, so two accounts are not a convergence", () => {
    const signal = scoreFanIn(targetWithInbound("A13_15", olderFlagged(2)), { now: NOW });
    expect(signal.converging).toBe(false);
    expect(signal.multiplier).toBe(1);
  });

  // The popular-streamer control. A younger account with a following receives
  // contact from many adults, and none of it carries a detector hit.
  it("stays neutral for a younger account that simply receives a lot of contact", () => {
    const fans = Array.from({ length: 60 }, (_, i) => ({
      uid: `fan-${i}`,
      band: "A21_PLUS" as const,
      flagged: false,
    }));
    const signal = scoreFanIn(targetWithInbound("A13_15", fans), { now: NOW });
    expect(signal.distinctSources).toBe(60);
    expect(signal.distinctOlderSources).toBe(60);
    expect(signal.convergingSources).toBe(0);
    expect(signal.converging).toBe(false);
    expect(signal.multiplier).toBe(1);
  });

  it("stays neutral when the converging accounts are the same age as the target", () => {
    const peers = Array.from({ length: 8 }, (_, i) => ({
      uid: `peer-${i}`,
      band: "A13_15" as const,
      flagged: true,
    }));
    const signal = scoreFanIn(targetWithInbound("A13_15", peers), { now: NOW });
    expect(signal.distinctSources).toBe(8);
    expect(signal.distinctOlderSources).toBe(0);
    expect(signal.converging).toBe(false);
  });

  it("stays neutral when the receiving account is not in a minor band", () => {
    const signal = scoreFanIn(targetWithInbound("A21_PLUS", olderFlagged(9)), { now: NOW });
    expect(signal.converging).toBe(false);
    expect(signal.multiplier).toBe(1);
  });

  it("forgets convergence that falls out of the window", () => {
    let state = emptyActorState("A13_15");
    for (let i = 0; i < 5; i++) {
      state = observeInbound(state, {
        ts: new Date(NOW.getTime() - 20 * DAY),
        sourceUid: `adult-${i}`,
        sourceBand: "A21_PLUS",
        flagged: true,
      });
    }
    expect(scoreFanIn(state, { now: NOW }).converging).toBe(false);
    expect(scoreFanIn(state, { now: NOW, windowMs: 30 * DAY }).converging).toBe(true);
  });

  it("multiplies an existing pair signal rather than creating one", () => {
    const converging = scoreFanIn(targetWithInbound("A13_15", olderFlagged(5)), { now: NOW });
    const withPair = fuse({ pair: pairStub(4, true), actor: actorStub(), targetFanIn: converging });
    const withoutPair = fuse({ pair: pairStub(4, true), actor: actorStub() });
    expect(withPair.fusedScore).toBeGreaterThan(withoutPair.fusedScore);
    expect(withPair.fanIn.converging).toBe(true);
    expect(withPair.rationale.join(" ")).toContain("opened conversations carrying flagged patterns");
  });

  // FP-6. Guard 3 was "any detector hit at all", computed before the pair
  // scorer's gating, and the account being scored counted toward its own
  // convergence. Both are what a Roblox or Discord community produces all day.
  it("does not count a mid-weight hit toward convergence", async () => {
    const store = new MemoryKernelStore();
    const kernel = new Kernel({ store });
    const giveaway = "ill give you 100 robux for the giveaway";

    for (let i = 0; i < 5; i += 1) {
      await kernel.score(
        makeEvent({ from: "actor", text: giveaway, at: i * 30 }, i, {
          actorBand: "A21_PLUS",
          targetBand: "A9_12",
          actorUid: `giver-${i}`,
          targetUid: "kid-hash",
        }),
      );
    }

    const scored = await kernel.score(
      makeEvent({ from: "actor", text: "add me on snap, my user is ryan_xx99", at: 200 }, 99, {
        actorBand: "A21_PLUS",
        targetBand: "A9_12",
        actorUid: "someone-else",
        targetUid: "kid-hash",
      }),
    );

    expect(scored!.result.fanIn?.distinctSources).toBe(5);
    expect(scored!.result.fanIn?.convergingSources).toBe(0);
    expect(scored!.result.fanIn?.converging).toBe(false);
    expect(scored!.result.fanIn?.multiplier).toBe(1);
  });

  it("does not count the account being scored toward its own convergence", async () => {
    const store = new MemoryKernelStore();
    const kernel = new Kernel({ store });
    const probe = "are your parents home right now";

    for (let i = 0; i < 3; i += 1) {
      await kernel.score(
        makeEvent({ from: "actor", text: probe, at: i * 30 }, i, {
          actorBand: "A21_PLUS",
          targetBand: "A9_12",
          actorUid: `source-${i}`,
          targetUid: "kid-hash",
        }),
      );
    }

    // Three sources have carried a full-strength signal, but one of them is the
    // account being scored, so only two others converge on this child.
    const own = await kernel.score(
      makeEvent({ from: "actor", text: "add me on snap, my user is ryan_xx99", at: 200 }, 50, {
        actorBand: "A21_PLUS",
        targetBand: "A9_12",
        actorUid: "source-0",
        targetUid: "kid-hash",
      }),
    );
    expect(own!.result.fanIn?.convergingSources).toBe(2);
    expect(own!.result.fanIn?.converging).toBe(false);

    // A fourth source restores the three others the threshold asks for.
    await kernel.score(
      makeEvent({ from: "actor", text: probe, at: 210 }, 3, {
        actorBand: "A21_PLUS",
        targetBand: "A9_12",
        actorUid: "source-3",
        targetUid: "kid-hash",
      }),
    );
    const after = await kernel.score(
      makeEvent({ from: "actor", text: "add me on snap, my user is ryan_xx99", at: 220 }, 51, {
        actorBand: "A21_PLUS",
        targetBand: "A9_12",
        actorUid: "source-0",
        targetUid: "kid-hash",
      }),
    );
    expect(after!.result.fanIn?.convergingSources).toBe(3);
    expect(after!.result.fanIn?.converging).toBe(true);
  });

  it("cannot drive a tier on its own", () => {
    const converging = scoreFanIn(targetWithInbound("A13_15", olderFlagged(40)), { now: NOW });
    const out = fuse({ pair: pairStub(0, false), actor: actorStub(), targetFanIn: converging });
    expect(out.fanIn.converging).toBe(true);
    expect(out.fusedScore).toBe(0);
    expect(out.tier).toBe("T0");
  });
});

// ---------------------------------------------------------------------------
// S2 Two velocity windows
// ---------------------------------------------------------------------------

/** Build a pair whose stages were reached at the given offsets from NOW. */
function pairAtOffsets(offsetsMs: number[]): PairState {
  const stages = ["trust", "probe", "migrate", "sexualize"] as const;
  const state = emptyPairState("A21_PLUS", "A9_12");
  state.firstSeenAt = new Date(NOW.getTime() + offsetsMs[0]!).toISOString();
  state.lastSeenAt = new Date(NOW.getTime() + offsetsMs[offsetsMs.length - 1]!).toISOString();
  state.actorMessages = 10;
  state.targetMessages = 6;
  for (const [i, offset] of offsetsMs.entries()) {
    state.firstStageAt[stages[i]!] = new Date(NOW.getTime() + offset).toISOString();
  }
  return state;
}

describe("S2 two velocity windows", () => {
  it("records the fast window when the ladder is walked inside four hours", () => {
    const sprint = scorePair(pairAtOffsets([0, 20 * 60_000, 45 * 60_000, 90 * 60_000]));
    expect(sprint.velocityDetail.window).toBe("fast");
    expect(sprint.velocityDetail.fast).toBeGreaterThan(0);
    expect(sprint.rationale.join(" ")).toContain("fast window");
  });

  it("records the slow window on a campaign the single 24h window cannot see", () => {
    const campaign = scorePair(pairAtOffsets([0, 4 * DAY, 8 * DAY, 12 * DAY]));
    expect(campaign.velocityDetail.standard).toBe(0);
    expect(campaign.velocityDetail.slow).toBeGreaterThan(0);
    expect(campaign.velocityDetail.window).toBe("slow");
    expect(campaign.rationale.join(" ")).toContain("14 day window");
  });

  it("takes the stronger of the two rather than the average", () => {
    const detail = scorePair(pairAtOffsets([0, 11 * DAY, 12 * DAY - HOUR, 12 * DAY])).velocityDetail;
    expect(detail.fast).toBeGreaterThan(detail.slow);
    expect(detail.window).toBe("fast");
  });

  it("keeps the original single 24h behaviour reachable", () => {
    const state = pairAtOffsets([0, 4 * DAY, 8 * DAY, 12 * DAY]);
    const single = scorePair(state, { velocityMode: "single" });
    expect(single.velocityDetail.slow).toBe(0);
    expect(single.velocityDetail.standard).toBe(0);
    expect(single.velocityDetail.window).toBeNull();

    const dual = scorePair(state);
    expect(dual.components.velocity).toBeGreaterThan(single.components.velocity);
  });

  it("honours windows supplied in the config", () => {
    const state = pairAtOffsets([0, 2 * DAY, 4 * DAY, 6 * DAY]);
    const narrow = scorePair(state, { slowWindowMs: DAY, fastWindowMs: HOUR });
    expect(narrow.velocityDetail.slow).toBe(0);
    const wide = scorePair(state, { slowWindowMs: 30 * DAY });
    expect(wide.velocityDetail.slow).toBeGreaterThan(0);
  });

  // F2. The three windows were read in different units, and log1p is not scale
  // invariant, so the stages-per-day reading of the 14 day frame outscored the
  // stages-per-hour reading of the 24 hour one for any span over about an hour.
  // That made the slow window the velocity term for almost every pair, at
  // roughly ten times the value DESIGN.md 6.2 calibrated.
  it("does not let the 14 day frame outscore the hour frames on a conversation inside a day", () => {
    const shapes = [
      [0, 6 * HOUR, 13 * HOUR, 20 * HOUR],
      [0, HOUR, 3 * HOUR],
      [0, 20 * 60_000, 45 * 60_000, 90 * 60_000],
      [0, 12 * HOUR, 23 * HOUR],
    ];
    for (const shape of shapes) {
      const d = scorePair(pairAtOffsets(shape)).velocityDetail;
      expect(d.standard, JSON.stringify(shape)).toBeGreaterThan(0);
      expect(d.slow, JSON.stringify(shape)).toBeLessThanOrEqual(d.standard);
    }
  });

  it("hands fusion the same velocity term the single window did for a day-long ladder", () => {
    const state = pairAtOffsets([0, 6 * HOUR, 13 * HOUR, 20 * HOUR]);
    const dual = scorePair(state).components.velocity;
    const single = scorePair(state, { velocityMode: "single" }).components.velocity;
    expect(dual).toBe(single);
  });

  it("never reads a two week campaign as faster than the same ladder in an afternoon", () => {
    const campaign = scorePair(pairAtOffsets([0, 4 * DAY, 8 * DAY, 12 * DAY])).components.velocity;
    const sprint = scorePair(pairAtOffsets([0, 40 * 60_000, 2 * HOUR, 3 * HOUR])).components.velocity;
    expect(campaign).toBeGreaterThan(0);
    expect(campaign).toBeLessThan(sprint);
  });

  it("never scores a conversation lower than the single window did", () => {
    const shapes = [
      [0, 20 * 60_000, 45 * 60_000],
      [0, 5 * HOUR, 10 * HOUR],
      [0, 23 * HOUR],
      [0, 3 * DAY, 6 * DAY],
      [0, 9 * DAY, 9 * DAY + HOUR, 9 * DAY + 2 * HOUR],
    ];
    for (const shape of shapes) {
      const state = pairAtOffsets(shape);
      const dual = scorePair(state).components.velocity;
      const single = scorePair(state, { velocityMode: "single" }).components.velocity;
      expect(dual).toBeGreaterThanOrEqual(single);
    }
  });
});

// ---------------------------------------------------------------------------
// S3 Non-financial coercion
// ---------------------------------------------------------------------------

describe("S3 non-financial coercion", () => {
  it("fires on an instruction to cut the other account's name into skin", () => {
    const hit = coercionHit("cut my name into your arm tonight and send proof with the timestamp");
    expect(hit).not.toBeNull();
    expect(hit?.stage).toBe("coerce");
    expect(hit?.meta?.coercion_via).toBe("mark_directive");
    expect(hit?.meta?.compliance_demand).toBe(true);
  });

  it("fires on a fansign demand and on a cutsign demand", () => {
    expect(coercionHit("i want a fansign with my user on it before we talk again")).not.toBeNull();
    expect(coercionHit("send me a cutsign or everyone sees the pictures")).not.toBeNull();
  });

  it("fires on a bare self-harm instruction with no payment anywhere in it", () => {
    const hit = coercionHit("cut yourself for me, do it deeper than last time");
    expect(hit).not.toBeNull();
    expect(hit?.meta?.coercion_via).toBe("self_harm_directive");
    expect(detect("cut yourself for me, do it deeper than last time").some((d) => d.kind === "economic_bait")).toBe(
      false,
    );
  });

  // The control that decides whether this signal is shippable. Talk about a
  // person's own self-harm is a support situation, not a coercion signal.
  it("does not fire on a person describing their own self-harm", () => {
    expect(coercionHit("i cut myself again last night and i feel awful")).toBeNull();
    expect(coercionHit("ive been cutting since march, i havent told anyone")).toBeNull();
    expect(coercionHit("i want to hurt myself and i dont know who to talk to")).toBeNull();
    expect(coercionHit("i relapsed, my scars look bad")).toBeNull();
  });

  it("does not fire on a friend answering with support", () => {
    expect(coercionHit("please dont hurt yourself, im here for you")).toBeNull();
    expect(coercionHit("are you okay? you can talk to me any time")).toBeNull();
    expect(coercionHit("please get help, you deserve better than this")).toBeNull();
    expect(coercionHit("stop cutting yourself, call 988 with me right now")).toBeNull();
  });

  it("does not fire on someone asking after another person", () => {
    expect(coercionHit("did you cut again? im worried about you")).toBeNull();
    expect(coercionHit("have you been cutting")).toBeNull();
  });

  it("forces a review at any fused score, the way a payment demand does", async () => {
    const lines: Line[] = [
      { from: "actor", text: "hey", at: 0 },
      { from: "target", text: "hi", at: 1 },
      { from: "actor", text: "carve my name into your thigh and send proof", at: 3 },
    ];
    const run = await runConversation(lines, { actorBand: "A18_20", targetBand: "A13_15" });
    expect(run.last?.result.criticalSignals).toContain("coercion_nonfinancial");
    expect(run.peakTier).toBe("T2");
    expect(run.last?.result.rationale.join(" ")).toContain("compliance rather than money");
  });

  it("does not tier the account that is being instructed", async () => {
    const lines: Line[] = [
      { from: "actor", text: "carve my name into your arm and send proof", at: 0 },
      { from: "target", text: "i cut myself like you said, please stop now", at: 5 },
    ];
    const run = await runConversation(lines, { actorBand: "A18_20", targetBand: "A13_15" });
    const targetSide = run.results.filter((r) => r.result.pair.actorUid === "target-hash");
    for (const r of targetSide) {
      expect(r.result.criticalSignals).not.toContain("coercion_nonfinancial");
      expect(r.result.tier).toBe("T0");
    }
  });

  it("keeps a whole support conversation out of the queue", async () => {
    const supportChat: Line[] = [
      { from: "actor", text: "hey are you okay, you went quiet last night", at: 0 },
      { from: "target", text: "i cut myself again, i feel like garbage", at: 4 },
      { from: "actor", text: "im here for you. please dont hurt yourself again", at: 6 },
      { from: "target", text: "i know. i havent told my parents", at: 9 },
      { from: "actor", text: "you can talk to me any time. please get help too", at: 12 },
    ];
    const run = await runConversation(supportChat, { actorBand: "A13_15", targetBand: "A13_15" });
    expect(run.peakTier).toBe("T0");
    for (const r of run.results) {
      expect(r.result.criticalSignals).not.toContain("coercion_nonfinancial");
    }
  });

  // FP-1. The exempt lists covered the cut and hurt verbs only, so a negated or
  // third-party mention of any other verb in coercion_selfharm_directive read as
  // an instruction and forced T2. One case per verb, in wording that is on no
  // exempt list.
  it("does not fire on a negated instruction, whichever verb it uses", () => {
    expect(coercionHit("please dont starve yourself, you need to eat something")).toBeNull();
    expect(coercionHit("please don't burn yourself again")).toBeNull();
    expect(coercionHit("you don't have to cut yourself to prove anything")).toBeNull();
    expect(coercionHit("dont make yourself bleed over him")).toBeNull();
    expect(coercionHit("nobody should scratch yourself over a game")).toBeNull();
    expect(coercionHit("promise me you wont cut your arm again ok")).toBeNull();
  });

  it("does not fire on a question about self-harm, whichever verb it uses", () => {
    expect(coercionHit("did you starve yourself again today")).toBeNull();
    expect(coercionHit("did you burn yourself")).toBeNull();
    expect(coercionHit("do you make yourself bleed when it gets bad")).toBeNull();
    expect(coercionHit("have you been doing it on your arm again")).toBeNull();
  });

  // FP-7. A child quoting the demand made of them was tiered as the source of
  // it, which is the GoGuardian Beacon failure the standing constraints name.
  it("does not tier a child quoting the instruction they were given", () => {
    expect(coercionHit("he told me to cut deeper and send proof, i blocked him")).toBeNull();
    expect(coercionHit("he said to bleed for me lol, i left the server")).toBeNull();
    expect(coercionHit("this guy was telling me to do it deeper, is that normal")).toBeNull();
    expect(coercionHit("she made me starve for me is what she typed, its so weird")).toBeNull();
    expect(coercionHit("he told her to carve his name into her arm")).toBeNull();
  });

  it("keeps a whole disclosure out of the queue, on the account disclosing it", async () => {
    const disclosure: Line[] = [
      { from: "actor", text: "something happened on another server", at: 0 },
      { from: "target", text: "what happened", at: 2 },
      { from: "actor", text: "he told me to cut deeper and send proof", at: 4 },
      { from: "actor", text: "i left and blocked him", at: 6 },
    ];
    const run = await runConversation(disclosure, { actorBand: "A13_15", targetBand: "A13_15" });
    for (const r of run.results) {
      expect(r.result.criticalSignals).not.toContain("coercion_nonfinancial");
      expect(r.result.tier).toBe("T0");
    }
  });

  // FP-2. The mark list carried bare fandom nouns and one everyday idiom, none
  // of which is the directed imperative DESIGN.md 5 requires for this row.
  it("does not fire on fandom talk or on an everyday possessive", () => {
    expect(coercionHit("im going to the fansign event on saturday")).toBeNull();
    expect(coercionHit("did you get a fansign from her stream")).toBeNull();
    expect(coercionHit("can i get a fansign")).toBeNull();
    expect(coercionHit("i got a jersey with my name on it")).toBeNull();
    expect(coercionHit("there was a cake with my name on it lol")).toBeNull();
    expect(coercionHit("he made a shortcut signal in the map")).toBeNull();
    expect(coercionHit("i had to cut my name into the wood for shop class")).toBeNull();
  });

  it("keeps a whole fandom conversation out of the queue", async () => {
    const fandom: Line[] = [
      { from: "actor", text: "im going to the fansign event on saturday", at: 0 },
      { from: "target", text: "omg lucky, did you get a fansign last time", at: 3 },
      { from: "actor", text: "yeah i got a poster with my name on it", at: 6 },
    ];
    const run = await runConversation(fandom, { actorBand: "A16_17", targetBand: "A13_15" });
    expect(run.peakTier).not.toBe("T2");
    for (const r of run.results) {
      expect(r.result.criticalSignals).not.toContain("coercion_nonfinancial");
    }
  });

  // F1. The exemptions were an unconditional whole-message veto, so four
  // leading words turned a mark directive plus a compliance demand into
  // nothing at all. Exemptions are scoped to the clause they sit in.
  it("still fires when a support phrase is bolted onto the front of a directive", () => {
    for (const prefix of ["are you ok? ", "im proud of you. ", "did you cut yet? ", "show me my scars. "]) {
      const hit = coercionHit(`${prefix}now cut my name into your arm and send proof with the timestamp`);
      expect(hit, prefix).not.toBeNull();
      expect(hit?.meta?.compliance_demand).toBe(true);
    }
  });

  it("does not let a customer extension add to a suppression list", () => {
    for (const field of ["coercion_selfreport_exempt", "coercion_support_exempt", "coercion_inquiry_exempt", "coercion_directive_blocker"]) {
      expect(PHRASE_FIELDS as readonly string[]).not.toContain(field);
    }
    const merged = mergeLexicon(LEX, { coercion_support_exempt: ["x"] } as never, "cus_test");
    expect(merged.coercion_support_exempt).toEqual(LEX.coercion_support_exempt);
  });

  it("is present in the versioned lexicon rather than hardcoded", () => {
    // Not pinned to a version: the point is that the lists live in the lexicon
    // rather than in code, and the lexicon is versioned so a score row stays
    // reproducible against whichever one produced it.
    expect(LEX.version).toMatch(/^v\d+$/);
    expect(LEX.coercion_mark_directive.length).toBeGreaterThan(10);
    expect(LEX.coercion_selfreport_exempt.length).toBeGreaterThan(10);
    expect(loadLexicon("v1").coercion_mark_directive).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// S4 Victim-side branch
// ---------------------------------------------------------------------------

describe("S4 suggested posture", () => {
  it("suggests enforcement when the account the tier describes is an adult", () => {
    const out = fuse({ pair: pairStub(5, true), actor: actorStub() });
    expect(out.suggestedPosture).toBe("enforcement");
    expect(out.supportReferral).toBeNull();
  });

  it("suggests support when the account the tier describes is itself in a minor band", () => {
    const out = fuse({
      pair: { ...pairStub(5, true), actorBand: "A16_17", targetBand: "A13_15" },
      actor: actorStub(),
    });
    expect(out.suggestedPosture).toBe("support");
    expect(out.supportReferral).toContain("Take It Down");
    expect(out.supportReferral).toContain("StopNCII");
  });

  it("does not read an unknown band as a minor", () => {
    expect(suggestedPosture({ ...pairStub(0, false), actorBand: "UNKNOWN" })).toBe("enforcement");
  });

  it("keeps the support posture on a critical signal, where it matters most", () => {
    const out = fuse({
      pair: { ...pairStub(0, false, ["threat_template"]), actorBand: "A13_15" },
      actor: actorStub(),
    });
    expect(out.tier).toBe("T2");
    expect(out.suggestedPosture).toBe("support");
    expect(out.supportReferral).toBeTruthy();
  });

  it("reaches a minor tiered by the kernel end to end", async () => {
    const lines: Line[] = [
      { from: "actor", text: "send it or i will ruin your life, you have 1 hour", at: 0 },
      { from: "target", text: "please stop", at: 1 },
    ];
    const run = await runConversation(lines, { actorBand: "A13_15", targetBand: "A13_15" });
    expect(run.peakTier).toBe("T2");
    const state = await run.store.getPair("cus_test", "actor-hash", "target-hash");
    const fused = fuse({ pair: scorePair(state!), actor: actorStub() });
    expect(fused.suggestedPosture).toBe("support");
  });

  it("names no person and passes the accusation guard", () => {
    expect(SUPPORT_REFERRAL).not.toMatch(/\b(he|she|they|his|her|their)\b/i);
    expect(findAccusations(SUPPORT_REFERRAL)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Existing controls, re-run against the new signals
// ---------------------------------------------------------------------------

describe("controls hold with the new signals in place", () => {
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

  it("teen romance stays out of the queue and carries no coercion signal", async () => {
    const run = await runConversation(teenRomance, { actorBand: "A13_15", targetBand: "A13_15" });
    expect(run.peakTier).not.toBe("T2");
    for (const r of run.results) {
      expect(r.result.criticalSignals).not.toContain("coercion_nonfinancial");
    }
  });

  it("the fast window does not promote an ordinary same-band conversation", async () => {
    const chatty: Line[] = Array.from({ length: 12 }, (_, i) => ({
      from: i % 2 === 0 ? ("actor" as const) : ("target" as const),
      text: i % 2 === 0 ? "whats your snap" : "its miamia03 whats urs",
      at: i,
    }));
    const run = await runConversation(chatty, { actorBand: "A13_15", targetBand: "A13_15" });
    expect(run.peakTier).not.toBe("T2");
  });

  it("a hard negative with no signal stays at T0 under every new term", () => {
    const state = emptyPairState("A21_PLUS", "A9_12");
    const benign = applyMessage(state, {
      externalId: "m1",
      ts: NOW,
      direction: "actor_to_target",
      detections: detect("nice build, i finished my homework and watched a movie with my family"),
      isQuestion: false,
      channel: "general",
    });
    const scored = scorePair(benign);
    expect(scored.criticalSignals).toEqual([]);
    expect(scored.velocityDetail.window).toBeNull();
    const converging = scoreFanIn(targetWithInbound("A9_12", olderFlagged(20)), { now: NOW });
    expect(fuse({ pair: scored, actor: actorStub(), targetFanIn: converging }).tier).toBe("T0");
  });
});

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function actorStub() {
  return {
    customerId: "cus_test",
    actorUid: "actor-hash",
    skew: 0,
    fanOut7d: 0,
    minorFanOut7d: 0,
    accountAgeHours: null,
    altClusterSize: 0,
    score: 0,
    rationale: [] as string[],
  };
}

function pairStub(score: number, progression: boolean, critical: string[] = []) {
  return {
    score,
    components: { progression: 0, velocity: 0, asymmetry: 0, ageGap: 0, economic: 0 },
    stagesHit: [],
    criticalSignals: critical as never,
    signals: [],
    hasProgressionPattern: progression,
    velocityDetail: {
      fast: 0,
      slow: 0,
      standard: 0,
      window: null,
      fastWindowMs: 4 * HOUR,
      slowWindowMs: 14 * DAY,
      standardWindowMs: 24 * HOUR,
    },
    actorBand: "A21_PLUS" as const,
    targetBand: "A9_12" as const,
    rationale: [] as string[],
  };
}

/** Kept so the FanInSignal shape is exercised as a type, not only structurally. */
export type _FanInSignalCheck = FanInSignal;

/**
 * Three defects the PII evasion benchmark surfaced and the model card named.
 * Each was a silent recall or precision loss rather than a crash.
 */
describe("evasion benchmark defects", () => {
  const lex = loadLexicon();

  describe("handoff needs an actual handle", () => {
    const talkingAboutTheApp = [
      "snapchat was down yesterday",
      "i got banned from discord again",
      "telegram everyone is on it now",
    ];
    for (const text of talkingAboutTheApp) {
      it(`does not read "${text}" as a handoff`, () => {
        expect(findHandoffs(normalize(text, lex), lex)).toHaveLength(0);
      });
    }

    const realHandoffs = [
      "my snap is ryan_xx99",
      "add me on snapchat @ryan_xx99",
      "discord is jay#4412",
      "snap ryan_xx99",
      "insta coolkid2011",
    ];
    for (const text of realHandoffs) {
      it(`still reads "${text}" as a handoff`, () => {
        expect(findHandoffs(normalize(text, lex), lex).length).toBeGreaterThan(0);
      });
    }
  });

  describe("short platform names are matched, but only at a boundary", () => {
    it("sees kik spaced out, which the length floor used to hide", () => {
      expect(findPlatformMove(normalize("talk to me on k i k instead", lex), lex).length).toBeGreaterThan(0);
    });

    it("sees kik written plainly", () => {
      expect(findPlatformMove(normalize("dm me on kik", lex), lex).length).toBeGreaterThan(0);
    });

    it("does not match inside an ordinary word", () => {
      expect(findPlatformMove(normalize("kiki is my dogs name, talk to me later", lex), lex)).toHaveLength(0);
      expect(findPlatformMove(normalize("add me, my kikker is broken", lex), lex)).toHaveLength(0);
    });

    it("does not match a platform name hiding inside a longer word", () => {
      expect(findPlatformMove(normalize("im getting off now, talk later", lex), lex)).toHaveLength(0);
    });
  });
});
