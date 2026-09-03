import { loadScriptCorpus } from "@guardian/schema";
import { describe, expect, it } from "vitest";
import { emptyActorState, fanOut, observeActor, scoreActor, skew } from "../src/actor.js";
import { ScriptIndex, jaccard } from "../src/detectors/minhash.js";
import { buildEvidenceBundle, summarizeBundle } from "../src/bundle.js";
import { fuse } from "../src/fusion.js";

describe("minhash script index", () => {
  const index = new ScriptIndex();
  for (const s of loadScriptCorpus().scripts) index.add(s.id, s.label, s.text);

  it("loads the corpus", () => {
    expect(index.size()).toBeGreaterThan(10);
  });

  it("estimates similarity as 1 for identical text", () => {
    const sig = index.signature("hello world this is a test string");
    expect(jaccard(sig, sig)).toBe(1);
  });

  it("matches a lightly reworded script", () => {
    const hit = index.query(
      "i have all of your friends and family list. if you dont send me the money i will send your pictures to everyone that you know. you have one hour",
      0.35,
    );
    expect(hit?.id).toBe("sx-001");
  });

  it("does not match ordinary conversation", () => {
    expect(index.query("hey do you want to play the new update tonight with me and my brother", 0.35)).toBeNull();
    expect(index.query("i finished my homework and then watched a movie with my family", 0.35)).toBeNull();
  });

  it("agrees with an exhaustive scan on the corpus itself", () => {
    for (const s of loadScriptCorpus().scripts) {
      expect(index.query(s.text, 0.5)?.id).toBe(index.queryExact(s.text, 0.5)?.id);
    }
  });
});

describe("actor graph features", () => {
  const now = new Date("2026-09-02T12:00:00Z");

  function actorWithContacts(count: number, band: "A9_12" | "A21_PLUS") {
    let state = emptyActorState("A21_PLUS");
    for (let i = 0; i < count; i++) {
      state = observeActor(state, {
        ts: new Date(now.getTime() - i * 60_000),
        targetUid: `t${i}`,
        targetBand: band,
        flagged: false,
      });
    }
    return state;
  }

  it("counts distinct targets, not messages", () => {
    let state = emptyActorState("A21_PLUS");
    for (let i = 0; i < 50; i++) {
      state = observeActor(state, {
        ts: new Date(now.getTime() - i * 1000),
        targetUid: "same-target",
        targetBand: "A9_12",
        flagged: false,
      });
    }
    expect(fanOut(state, 7, now)).toBe(1);
  });

  it("separates fan-out to minor bands from fan-out overall", () => {
    const state = actorWithContacts(30, "A21_PLUS");
    expect(fanOut(state, 7, now)).toBe(30);
    expect(fanOut(state, 7, now, true)).toBe(0);
  });

  it("raises the actor score on wide contact with younger bands", () => {
    const wide = scoreActor("cus", "a", actorWithContacts(40, "A9_12"), { now });
    const narrow = scoreActor("cus", "a", actorWithContacts(2, "A9_12"), { now });
    expect(wide.score).toBeGreaterThan(narrow.score);
    expect(wide.minorFanOut7d).toBe(40);
  });

  it("needs enough messages before reporting skew", () => {
    let state = emptyActorState("A21_PLUS");
    state = observeActor(state, { ts: now, targetUid: "t", targetBand: "A9_12", flagged: true });
    expect(skew(state, now)).toBe(0);
  });

  it("weights recent flagged messages above old ones", () => {
    let recent = emptyActorState("A21_PLUS");
    let old = emptyActorState("A21_PLUS");
    for (let i = 0; i < 20; i++) {
      recent = observeActor(recent, {
        ts: new Date(now.getTime() - i * 3600_000),
        targetUid: `t${i}`,
        targetBand: "A9_12",
        flagged: i < 10,
      });
      old = observeActor(old, {
        ts: new Date(now.getTime() - (20 - i) * 24 * 3600_000),
        targetUid: `t${i}`,
        targetBand: "A9_12",
        flagged: i < 10,
      });
    }
    expect(skew(recent, now)).toBeGreaterThan(skew(old, now));
  });

  it("flags a device hint shared with an account the operator actioned", () => {
    let state = emptyActorState("A21_PLUS");
    state = observeActor(state, {
      ts: now,
      targetUid: "t",
      targetBand: "A9_12",
      flagged: false,
      hints: ["hint-abc"],
    });
    const scored = scoreActor("cus", "a", state, { now, bannedHints: new Set(["hint-abc"]) });
    expect(scored.altCluster).toBe(true);
    expect(scored.altClusterSize).toBe(1);
  });
});

describe("fusion gates", () => {
  const baseActor = {
    customerId: "c",
    actorUid: "a",
    skew: 0,
    fanOut7d: 0,
    minorFanOut7d: 0,
    accountAgeHours: null,
    altClusterSize: 0,
    score: 0,
    rationale: [] as string[],
  };

  function pair(score: number, progression: boolean, critical: string[] = []) {
    return {
      score,
      components: { progression: 0, velocity: 0, asymmetry: 0, ageGap: 0, economic: 0 },
      stagesHit: [],
      criticalSignals: critical as never,
      signals: [],
      hasProgressionPattern: progression,
      rationale: [],
    };
  }

  it("holds a high score at T1 without an ordered progression pattern", () => {
    const out = fuse({ pair: pair(9, false), actor: baseActor });
    expect(out.tier).toBe("T1");
    expect(out.gate).toContain("no ordered progression pattern");
  });

  it("reaches T2 on a high score with a progression pattern", () => {
    expect(fuse({ pair: pair(9, true), actor: baseActor }).tier).toBe("T2");
  });

  it("reaches T2 on a critical signal at any score", () => {
    const out = fuse({ pair: pair(0, false, ["threat_template"]), actor: baseActor });
    expect(out.tier).toBe("T2");
    expect(out.rationale[0]).toContain("extortion script");
  });

  it("never returns T3", () => {
    const out = fuse({ pair: pair(100, true, ["threat_template", "known_csam_hash"]), actor: baseActor });
    expect(out.tier).toBe("T2");
  });
});

describe("evidence bundle", () => {
  const bundle = buildEvidenceBundle({
    customerId: "cus_1",
    actorUid: "a",
    targetUid: "b",
    tier: "T2",
    timeline: [
      {
        ts: new Date("2026-09-02T12:05:00Z"),
        channel: "general",
        direction: "actor_to_target",
        text: "x".repeat(900),
        mediaSha256: null,
        knownCsamVerdict: null,
        stage: "probe",
        signals: ["supervision_probe"],
      },
      {
        ts: new Date("2026-09-02T12:00:00Z"),
        channel: "general",
        direction: "target_to_actor",
        text: null,
        mediaSha256: "d".repeat(64),
        knownCsamVerdict: "no_match",
        stage: null,
        signals: [],
      },
    ],
    signals: [],
    versions: { modelVersion: "rules-v1", lexiconVersion: "v1", fusionVersion: "rules-v1" },
    provenance: [
      { surface: "discord", sourceId: "guild-1" },
      { surface: "discord", sourceId: "guild-1" },
    ],
    auditHead: "a".repeat(64),
  });

  it("orders the timeline by time", () => {
    expect(bundle.timeline[0]!.direction).toBe("target_to_actor");
  });

  it("caps excerpt length so a bundle is not a transcript dump", () => {
    expect(bundle.timeline[1]!.excerpt!.length).toBe(500);
  });

  it("carries hashes and verdicts but no bytes", () => {
    expect(bundle.timeline[0]!.mediaSha256).toBe("d".repeat(64));
    expect(JSON.stringify(bundle)).not.toContain("base64");
  });

  it("dedupes provenance and anchors to the audit head", () => {
    expect(bundle.provenance).toHaveLength(1);
    expect(bundle.auditHead).toHaveLength(64);
  });

  it("sets a one year retention only once a reviewer confirms", () => {
    expect(bundle.retention).toBe("WATCH_30D");
  });

  it("summarizes without characterising a person", () => {
    const text = summarizeBundle(bundle, ["Supervision probing followed by a migration ask."]);
    expect(text).toContain("Tier T2");
    expect(text).toContain("not a determination about any person");
  });
});
