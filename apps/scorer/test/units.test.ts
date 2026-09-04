import { loadScriptCorpus } from "@guardian/schema";
import { describe, expect, it } from "vitest";
import {
  emptyActorState,
  fanIn,
  fanOut,
  observeActor,
  observeInbound,
  scoreActor,
  skew,
} from "../src/actor.js";
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

  it("counts inbound sources once each, however many messages they send", () => {
    let target = emptyActorState("A9_12");
    for (let i = 0; i < 20; i++) {
      target = observeInbound(target, {
        ts: new Date(now.getTime() - i * 60_000),
        sourceUid: i % 2 === 0 ? "src-a" : "src-b",
        sourceBand: "A21_PLUS",
        flagged: true,
      });
    }
    expect(fanIn(target, 7 * 24 * 3600_000, now)).toBe(2);
    expect(fanIn(target, 7 * 24 * 3600_000, now, { olderOnly: true })).toBe(2);
  });

  it("keeps the two halves of the graph apart", () => {
    let state = emptyActorState("A13_15");
    state = observeActor(state, { ts: now, targetUid: "t1", targetBand: "A13_15", flagged: false });
    state = observeInbound(state, {
      ts: now,
      sourceUid: "s1",
      sourceBand: "A21_PLUS",
      flagged: true,
    });
    expect(fanOut(state, 7, now)).toBe(1);
    expect(fanIn(state, 7 * 24 * 3600_000, now)).toBe(1);
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
      velocityDetail: {
        fast: 0,
        slow: 0,
        standard: 0,
        window: null as null,
        fastWindowMs: 4 * 3600_000,
        slowWindowMs: 14 * 24 * 3600_000,
        standardWindowMs: 24 * 3600_000,
      },
      actorBand: "A21_PLUS" as const,
      targetBand: "A9_12" as const,
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
  const rows = [
    {
      ts: new Date("2026-09-02T12:05:00Z"),
      channel: "general",
      direction: "actor_to_target" as const,
      text: "x".repeat(900),
      mediaSha256: null,
      knownCsamVerdict: null,
      stage: "probe" as const,
      signals: ["supervision_probe" as const],
      surface: "discord" as const,
      channelVisibility: "public" as const,
      actorAge: { band: "A18_20" as const, confidence: 0.4, provenance: "server_role" as const },
      targetAge: { band: "A13_15" as const, confidence: 0.7, provenance: "server_role" as const },
    },
    {
      ts: new Date("2026-09-02T12:00:00Z"),
      channel: "general",
      direction: "target_to_actor" as const,
      text: null,
      mediaSha256: "d".repeat(64),
      knownCsamVerdict: "no_match" as const,
      stage: null,
      signals: [],
    },
  ];

  const base = {
    customerId: "cus_1",
    actorUid: "a",
    targetUid: "b",
    tier: "T2" as const,
    timeline: rows,
    signals: [],
    versions: { modelVersion: "rules-v1", lexiconVersion: "v1", fusionVersion: "rules-v1" },
    provenance: [
      { surface: "discord" as const, sourceId: "guild-1" },
      { surface: "discord" as const, sourceId: "guild-1" },
    ],
    auditHead: "a".repeat(64),
  };

  const bundle = buildEvidenceBundle(base);

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

  it("keeps the version triple through the reporting shape", () => {
    expect(bundle.versions).toEqual({
      modelVersion: "rules-v1",
      lexiconVersion: "v1",
      fusionVersion: "rules-v1",
    });
  });

  it("sets a one year retention only once a reviewer confirms", () => {
    expect(bundle.retention).toBe("WATCH_30D");
  });

  it("summarizes without characterising a person", () => {
    const text = summarizeBundle(bundle, ["Supervision probing followed by a migration ask."]);
    expect(text).toContain("Tier T2");
    expect(text).toContain("not a determination about any person");
  });

  /* ---------------------------------------------------------------------- */
  /* Reporting superset (RESEARCH.md gap A6)                                 */
  /* ---------------------------------------------------------------------- */

  describe("jurisdiction and legal basis", () => {
    it("copies both from the customer at generation time", () => {
      const out = buildEvidenceBundle({
        ...base,
        jurisdiction: { country: "US", subdivision: "TX" },
        legalBasis: "provider_2258a",
      });
      expect(out.jurisdiction).toEqual({ country: "US", subdivision: "TX" });
      expect(out.legalBasis).toBe("provider_2258a");
      expect(out.completeness.missing).not.toContain("reporter_jurisdiction");
    });

    it("reports the gap rather than guessing when the customer states neither", () => {
      expect(bundle.jurisdiction).toBeNull();
      expect(bundle.completeness.missing).toContain("reporter_jurisdiction");
      expect(bundle.completeness.missing).toContain("legal_basis");
    });
  });

  describe("timezone", () => {
    const zoned = buildEvidenceBundle({ ...base, timezone: "America/New_York" });

    it("renders every timestamp in the customer's zone with an explicit offset", () => {
      expect(zoned.timezone).toBe("America/New_York");
      expect(zoned.timezoneSource).toBe("customer");
      expect(zoned.timeline[0]!.tsLocal).toBe("2026-09-02T08:00:00-04:00");
      expect(zoned.timeline[0]!.tsOffsetMinutes).toBe(-240);
      expect(zoned.generatedAtLocal).toMatch(/[+-]\d{2}:\d{2}$/);
    });

    it("uses the offset in force at each instant, not one offset for the bundle", () => {
      const winter = buildEvidenceBundle({
        ...base,
        timezone: "America/New_York",
        timeline: [{ ...rows[1]!, ts: new Date("2026-01-15T12:00:00Z") }, rows[0]!],
      });
      expect(winter.timeline[0]!.tsOffsetMinutes).toBe(-300);
      expect(winter.timeline[1]!.tsOffsetMinutes).toBe(-240);
    });

    it("falls back to UTC and says so rather than claiming a zone nobody set", () => {
      expect(bundle.timezone).toBe("UTC");
      expect(bundle.timezoneSource).toBe("default_utc");
      expect(bundle.completeness.missing).toContain("incident_timezone");
      expect(buildEvidenceBundle({ ...base, timezone: "Mars/Olympus" }).timezoneSource).toBe(
        "default_utc",
      );
    });
  });

  describe("reporter of record", () => {
    it("names the customer as the reporter and defaults to the customer filing", () => {
      expect(bundle.reporter.customerId).toBe("cus_1");
      expect(bundle.reporter.filingMode).toBe("customer_direct");
      expect(bundle.completeness.missing).toContain("reporter_identity");
    });

    it("records Guardian filing as the customer's agent when the customer has an ESP id", () => {
      const out = buildEvidenceBundle({
        ...base,
        reporter: {
          providerName: "Example Games",
          espId: "esp_123",
          filingMode: "guardian_as_agent",
          contactOnFile: true,
        },
      });
      expect(out.reporter.filingMode).toBe("guardian_as_agent");
      expect(out.reporter.customerId).toBe("cus_1");
      expect(out.completeness.missing).not.toContain("reporter_identity");
      expect(out.completeness.missing).not.toContain("reporter_contact");
    });
  });

  describe("reviewer context", () => {
    const reviewer = {
      reviewerId: "rev_hash_1",
      reviewId: "rvw_1",
      decision: "report" as const,
      modelTier: "T2" as const,
      resultTier: "T3" as const,
      decidedAt: new Date("2026-09-02T14:00:00Z"),
      reasonCode: "escalation_pattern",
      notes: { timeline: "Two migration asks after a supervision question." },
      viewedExcerptCount: 2,
      concurringReviewerId: "rev_hash_2",
    };

    it("is null on a bundle the kernel generated, and the gap is named", () => {
      expect(bundle.reviewer).toBeNull();
      expect(bundle.completeness.missing).toContain("human_review_confirmation");
      expect(bundle.completeness.missing).toContain("reviewer_narrative");
    });

    it("carries who decided, when in local time, what they wrote and how much they read", () => {
      const out = buildEvidenceBundle({ ...base, timezone: "America/New_York", reviewer });
      expect(out.reviewer!.reviewerId).toBe("rev_hash_1");
      expect(out.reviewer!.modelTier).toBe("T2");
      expect(out.reviewer!.resultTier).toBe("T3");
      expect(out.reviewer!.viewedExcerptCount).toBe(2);
      expect(out.reviewer!.notes!.timeline).toContain("migration asks");
      expect(out.reviewer!.decidedAtLocal).toBe("2026-09-02T10:00:00-04:00");
      expect(out.completeness.missing).not.toContain("human_review_confirmation");
      expect(out.completeness.missing).not.toContain("reviewer_narrative");
    });

    it("still names the gap when a reviewer decided something short of T3", () => {
      const out = buildEvidenceBundle({
        ...base,
        reviewer: { ...reviewer, decision: "confirm", resultTier: "T2" },
      });
      expect(out.completeness.missing).toContain("human_review_confirmation");
    });

    it("cannot claim a person read an excerpt with no reviewer decision behind it", () => {
      const claimed = buildEvidenceBundle({
        ...base,
        timeline: [{ ...rows[0]!, viewedByHuman: true }],
      });
      expect(claimed.timeline[0]!.viewedByHuman).toBe(false);

      const reviewed = buildEvidenceBundle({
        ...base,
        reviewer,
        timeline: [{ ...rows[0]!, viewedByHuman: true }],
      });
      expect(reviewed.timeline[0]!.viewedByHuman).toBe(true);
    });
  });

  describe("per-excerpt provenance", () => {
    it("carries the surface, the channel visibility and the bands with their provenance", () => {
      const row = bundle.timeline[1]!;
      expect(row.surface).toBe("discord");
      expect(row.channelVisibility).toBe("public");
      expect(row.targetAge).toEqual({
        band: "A13_15",
        confidence: 0.7,
        provenance: "server_role",
      });
      expect(row.viewedByHuman).toBe(false);
    });

    it("defaults an unstated band provenance to unknown rather than to a claim", () => {
      const out = buildEvidenceBundle({
        ...base,
        timeline: [{ ...rows[0]!, targetAge: { band: "A13_15" } }],
      });
      expect(out.timeline[0]!.targetAge).toEqual({
        band: "A13_15",
        confidence: null,
        provenance: "unknown",
      });
      const band = out.completeness.fields.find((f) => f.field === "child_age_band")!;
      expect(band.status).toBe("filled");
      expect(band.note).toContain("age assurance");
    });

    it("records null where the surface stated no band at all", () => {
      expect(bundle.timeline[0]!.targetAge).toBeNull();
    });
  });

  describe("completeness", () => {
    it("covers every report field exactly once", () => {
      const seen = bundle.completeness.fields.map((f) => f.field);
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).toContain("audit_chain_anchor");
      expect(seen).toContain("model_versions");
    });

    it("marks the anchor and the version triple filled", () => {
      const filled = bundle.completeness.fields
        .filter((f) => f.status === "filled")
        .map((f) => f.field);
      expect(filled).toContain("audit_chain_anchor");
      expect(filled).toContain("model_versions");
      expect(filled).toContain("chat_excerpts");
    });

    it("separates a case with no media from one missing a field", () => {
      const textOnly = buildEvidenceBundle({ ...base, timeline: [rows[0]!] });
      const media = textOnly.completeness.fields.find((f) => f.field === "media_hash")!;
      expect(media.status).toBe("not_applicable");
      expect(textOnly.completeness.missing).not.toContain("media_hash");
    });

    it("marks the scanner verdict filled from the operator's own answer", () => {
      const verdict = bundle.completeness.fields.find((f) => f.field === "media_scanner_verdict")!;
      expect(verdict.status).toBe("filled");
      const notRun = buildEvidenceBundle({
        ...base,
        timeline: [{ ...rows[1]!, knownCsamVerdict: "not_run" }],
      });
      expect(notRun.completeness.missing).toContain("media_scanner_verdict");
    });

    it("notes that the account identifiers are per-customer hashes", () => {
      const actor = bundle.completeness.fields.find(
        (f) => f.field === "reported_account_identifier",
      )!;
      expect(actor.status).toBe("filled");
      expect(actor.note).toContain("Salted-hashed per customer");
    });

    it("states the IP capture gap rather than leaving the filer to find it", () => {
      const ip = bundle.completeness.fields.find(
        (f) => f.field === "reported_account_ip_capture",
      )!;
      expect(ip.status).toBe("empty");
      expect(ip.note).toContain("no IP addresses");
    });

    it("is complete only when nothing the report needs is empty", () => {
      expect(bundle.completeness.complete).toBe(false);
      expect(bundle.completeness.missing.length).toBeGreaterThan(0);
      expect(bundle.completeness.missing).toEqual(
        bundle.completeness.fields.filter((f) => f.status === "empty").map((f) => f.field),
      );
    });

    it("names the unfilled fields in the summary so the gap is seen before filing", () => {
      const text = summarizeBundle(bundle, []);
      expect(text).toContain("Report fields still unfilled");
      expect(text).toContain("reporter_jurisdiction");
    });
  });
});
