import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { mockSession } from "./auth";
import type { Session } from "./session";
import {
  DecisionRefused,
  REASONS,
  reasonsFor,
  recordDecision,
  resolveResultTier,
  undoDecision,
  withdrawProposal,
} from "./decisions";
import { listAuditEntries } from "./data/audit";
import { listQueue, markExcerptsViewed } from "./data/cases";
import { getMockData, resetMockData } from "./mock/fixtures";

const session = mockSession();
const second = { ...session, reviewerId: "rev_second", displayName: "M. Osei" };

beforeEach(() => {
  resetMockData();
});

/**
 * Confirm and propose both claim a person read the evidence, and the server
 * checks its own record of that rather than the browser's count, so a test that
 * wants either has to read something first.
 */
async function readEverything(pairId: string, who: Session = session): Promise<string[]> {
  const data = await getMockData();
  const pair = data.pairs.find((p) => p.queue.pairId === pairId);
  const rows = pair?.timeline.state === "ready" ? pair.timeline.rows : [];
  return markExcerptsViewed(who, pairId, rows.map((row) => row.id));
}

describe("reason taxonomy", () => {
  it("carries a label and a definition for every code, and no duplicates", () => {
    const codes = REASONS.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const reason of REASONS) {
      expect(reason.label.length).toBeGreaterThan(0);
      expect(reason.definition.length).toBeGreaterThan(0);
    }
  });

  it("groups reasons under exactly one decision each", () => {
    expect(reasonsFor("dismiss").length).toBeGreaterThan(0);
    expect(reasonsFor("watch").length).toBeGreaterThan(0);
    expect(reasonsFor("confirm").length).toBeGreaterThan(0);
    expect(reasonsFor("report").length).toBeGreaterThan(0);
    expect(reasonsFor("dismiss").every((r) => r.code.startsWith("dismiss."))).toBe(true);
  });
});

describe("resolveResultTier", () => {
  it("maps the three recordable decisions to their tiers", () => {
    expect(resolveResultTier("dismiss", "T2").tier).toBe("T0");
    expect(resolveResultTier("watch", "T2").tier).toBe("T1");
    expect(resolveResultTier("confirm", "T2").tier).toBe("T2");
  });

  it("writes no tier for a proposal", () => {
    const result = resolveResultTier("report", "T2");
    expect(result.state).toBe("proposed");
    expect(result.tier).toBe("T2");
  });

  it("produces T3 only on an upheld concurrence, and T2 on an overturn", () => {
    const upheld = resolveResultTier("report", "T2", {
      proposalReviewId: "rvw_1",
      proposerReviewerId: "rev_a",
      upheld: true,
    });
    expect(upheld.tier).toBe("T3");
    const overturned = resolveResultTier("report", "T2", {
      proposalReviewId: "rvw_1",
      proposerReviewerId: "rev_a",
      upheld: false,
    });
    expect(overturned.tier).toBe("T2");
    expect(overturned.state).toBe("overturned");
  });
});

describe("recordDecision", () => {
  it("records a dismissal, moves the pair to T0 and appends to the chain", async () => {
    const result = await recordDecision({
      session,
      pairId: "pair_aa19",
      decision: "dismiss",
      reasonCode: "dismiss.economy_transaction",
    });
    expect(result.resultTier).toBe("T0");
    expect(result.state).toBe("recorded");
    expect(result.auditSeq).toBeGreaterThan(0);

    const data = await getMockData();
    const pair = data.pairs.find((p) => p.queue.pairId === "pair_aa19");
    expect(pair?.queue.tier).toBe("T0");
    expect(pair?.queue.resolvedAt).not.toBeNull();
  });

  it("refuses a reason that belongs to another decision", async () => {
    await expect(
      recordDecision({
        session,
        pairId: "pair_aa19",
        decision: "dismiss",
        reasonCode: "confirm.migration_ask_with_gap",
      }),
    ).rejects.toBeInstanceOf(DecisionRefused);
  });

  it("requires the timeline note on a confirm", async () => {
    await expect(
      recordDecision({
        session,
        pairId: "pair_4f2a",
        decision: "confirm",
        reasonCode: "confirm.progression_pattern",
      }),
    ).rejects.toMatchObject({ code: "note_required" });
  });

  it("writes no tier for a proposal, so the model never reaches T3", async () => {
    await readEverything("pair_4f2a");
    const result = await recordDecision({
      session,
      pairId: "pair_4f2a",
      decision: "report",
      reasonCode: "propose.online_enticement",
      notes: { timeline: "Supervision probe, then a migration ask 4 minutes later." },
    });
    expect(result.state).toBe("proposed");
    expect(result.resultTier).not.toBe("T3");

    const data = await getMockData();
    expect(data.pairs.find((p) => p.queue.pairId === "pair_4f2a")?.queue.tier).toBe("T2");
  });

  it("produces T3 only when a second reviewer upholds somebody else's proposal", async () => {
    await readEverything("pair_4f2a");
    const proposal = await recordDecision({
      session,
      pairId: "pair_4f2a",
      decision: "report",
      reasonCode: "propose.online_enticement",
      notes: { timeline: "Supervision probe, then a migration ask 4 minutes later." },
    });

    // The second reviewer reads it themselves. Pair.humanViewedAt is already
    // set by the proposer and says nothing about who, so a concurrence that
    // trusted it would be one person reading twice.
    await readEverything("pair_4f2a", second);
    const upheld = await recordDecision({
      session: second,
      pairId: "pair_4f2a",
      decision: "report",
      reasonCode: "uphold.independent_agreement",
      notes: { timeline: "Read independently and reached the same ordered pattern." },
      concurrence: {
        proposalReviewId: proposal.review.id,
        proposerReviewerId: session.reviewerId,
        upheld: true,
      },
    });
    expect(upheld.resultTier).toBe("T3");
    expect(upheld.state).toBe("upheld");
  });

  it("refuses a reviewer concurring with their own proposal", async () => {
    await readEverything("pair_4f2a");
    const proposal = await recordDecision({
      session,
      pairId: "pair_4f2a",
      decision: "report",
      reasonCode: "propose.online_enticement",
      notes: { timeline: "Supervision probe, then a migration ask." },
    });
    await expect(
      recordDecision({
        session,
        pairId: "pair_4f2a",
        decision: "report",
        reasonCode: "uphold.independent_agreement",
        notes: { timeline: "Same person, second seat." },
        concurrence: {
          proposalReviewId: proposal.review.id,
          proposerReviewerId: session.reviewerId,
          upheld: true,
        },
      }),
    ).rejects.toMatchObject({ code: "t3_requires_second_person" });
  });

  it("blocks a proposal when the tier rests on the actor score alone", async () => {
    await expect(
      recordDecision({
        session,
        pairId: "pair_3c88",
        decision: "report",
        reasonCode: "propose.online_enticement",
        notes: { timeline: "Nothing on the pair carried a signal." },
      }),
    ).rejects.toMatchObject({ code: "sole_automated_basis" });
  });

  it("refuses confirm and propose until an excerpt has been rendered to a person", async () => {
    await expect(
      recordDecision({
        session,
        pairId: "pair_4f2a",
        decision: "confirm",
        reasonCode: "confirm.progression_pattern",
        notes: { timeline: "Supervision probe, then a migration ask." },
        // The browser can claim any count it likes. The server does not read it.
        viewedExcerptCount: 12,
      }),
    ).rejects.toMatchObject({ code: "excerpt_not_read" });

    await readEverything("pair_4f2a");
    const allowed = await recordDecision({
      session,
      pairId: "pair_4f2a",
      decision: "confirm",
      reasonCode: "confirm.progression_pattern",
      notes: { timeline: "Supervision probe, then a migration ask." },
    });
    expect(allowed.resultTier).toBe("T2");
  });

  /**
   * A tier two reviewers produced is not undone by one. The reopen panel
   * refused this in the browser and the server action did not, so a session
   * that had proposed nothing could dismiss a reported case, and the review row
   * it wrote recorded modelTier "T3" on a chain that then asserted the model
   * had reached it.
   *
   * This refusal now happens before a review row is written at all, which makes
   * undoDecision's own cannot_restore_t3 guard unreachable through this path.
   * That guard stays as the second lock: it is the one that would hold if a
   * later caller found another way to a decision on a T3 pair.
   */
  it("refuses any lone decision on a pair already at T3", async () => {
    await readEverything("pair_c5e1");
    for (const [decision, reasonCode] of [
      ["watch", "watch.insufficient_context"],
      ["dismiss", "dismiss.same_band_no_gap"],
    ] as const) {
      await expect(
        recordDecision({ session, pairId: "pair_c5e1", decision, reasonCode }),
      ).rejects.toMatchObject({ code: "t3_already_recorded" });
    }

    const data = await getMockData();
    expect(data.pairs.find((p) => p.queue.pairId === "pair_c5e1")?.queue.tier).toBe("T3");
  });

  it("undo restores the tier the decision replaced, not a tier the caller picked", async () => {
    const data = await getMockData();
    const before = data.pairs.find((p) => p.queue.pairId === "pair_aa19")?.queue.tier;
    const result = await recordDecision({
      session,
      pairId: "pair_aa19",
      decision: "dismiss",
      reasonCode: "dismiss.economy_transaction",
    });
    const undone = await undoDecision(session, result.review.id);
    expect(undone.auditSeq).toBeGreaterThan(result.auditSeq);
    expect(undone.restoredTier).toBe(before);

    const pair = data.pairs.find((p) => p.queue.pairId === "pair_aa19");
    expect(pair?.queue.tier).toBe(before);
    expect(pair?.queue.resolvedAt).toBeNull();
    expect(data.reviews.find((r) => r.id === result.review.id)?.resultTier).toBe("T0");
  });

  it("refuses an undo of somebody else's decision", async () => {
    const result = await recordDecision({
      session,
      pairId: "pair_aa19",
      decision: "dismiss",
      reasonCode: "dismiss.economy_transaction",
    });
    await expect(undoDecision(second, result.review.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

/**
 * CLAUDE.md rule 6, as a test rather than a promise. If a new file needs to
 * write a pair's tier, this fails, and adding it to the allowlist is a code
 * review about the one rule the product cannot get wrong.
 *
 * It scans for the mechanism, not for the string "T3". The previous version
 * matched only an object literal key assigned a quoted T3, which is a shape
 * that appears nowhere in this codebase: the real write is `tier: resultTier`,
 * a variable, so an escalation helper doing `tx.pair.update({ data: { tier:
 * nextTier } })` passed the scan and the suite stayed green.
 */
describe("the only pair-tier write path", () => {
  // vitest runs from the package root, and import.meta.url is not a file URL
  // under jsdom, so the walk starts from the package instead.
  const srcRoot = resolve(process.cwd(), "src");
  const ALLOWED = new Set(["lib/decisions.ts", "lib/decisions.test.ts", "lib/mock/fixtures.ts"]);

  /** A Prisma write against Pair whose payload carries a tier key, in any form. */
  const PAIR_WRITE = /\.pair\.(update|updateMany|upsert|create|createMany)\s*\(/g;
  /**
   * A tier-named binding assigned the literal T3, whatever the syntax: an
   * object key, a const, or one carrying a type annotation.
   */
  const T3_LITERAL = /\b(\w*tier)\b\s*(?::\s*\w+\s*)?[:=]\s*["']T3["']/gi;

  function assignsT3(source: string): boolean {
    T3_LITERAL.lastIndex = 0;
    for (let match = T3_LITERAL.exec(source); match; match = T3_LITERAL.exec(source)) {
      // A bare `Tier` is the type on a comparison constant, not a target: the
      // resolved-case panel holds one to compare a tier against.
      if (match[1] !== "Tier") return true;
    }
    return false;
  }

  /** True when a source file writes a pair's tier by either route. */
  function writesPairTier(source: string): boolean {
    if (assignsT3(source)) return true;
    PAIR_WRITE.lastIndex = 0;
    for (let match = PAIR_WRITE.exec(source); match; match = PAIR_WRITE.exec(source)) {
      // The call's argument object, bounded so a later unrelated tier key in
      // the same file is not attributed to this write.
      const payload = source.slice(match.index, match.index + 600);
      if (/\btier\s*:/.test(payload)) return true;
    }
    return false;
  }

  function walk(dir: string, prefix = ""): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      if (statSync(full).isDirectory()) out.push(...walk(full, rel));
      else if (rel.endsWith(".ts") || rel.endsWith(".tsx")) out.push(rel);
    }
    return out;
  }

  it("catches a tier write built from a variable, not only a quoted T3", () => {
    expect(
      writesPairTier(`await tx.pair.update({ where: { id }, data: { tier: nextTier } });`),
    ).toBe(true);
    expect(writesPairTier(`const REPORT_TIER: Tier = "T3";`)).toBe(true);
    expect(writesPairTier(`data: { resultTier: "T3" }`)).toBe(true);
    // A constant held to compare a tier against is a read, not a write.
    expect(writesPairTier(`const REPORTED: Tier = "T3";`)).toBe(false);
    expect(writesPairTier(`await tx.pair.updateMany({ data: { resolvedAt: null } });`)).toBe(false);
    // Reading a tier is not writing one, and every mapper in the app does it.
    expect(writesPairTier(`return { tier: row.tier as Tier };`)).toBe(false);
  });

  it("is decisions.ts, and nothing else in this app writes a pair's tier", () => {
    const offenders = walk(srcRoot).filter(
      (rel) => !ALLOWED.has(rel) && writesPairTier(readFileSync(join(srcRoot, rel), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps every allowlisted file present, so the list cannot rot into a pass", () => {
    for (const rel of ALLOWED) {
      expect(statSync(join(srcRoot, rel)).isFile()).toBe(true);
    }
  });
});

/*
 * The concurrence path: the only route to tier T3, and the one the console
 * could not reach at all until the panel existed.
 *
 * pair_91c7 carries a fixture proposal from rev_mo, so these run against the
 * shape a second reviewer actually meets rather than one built inside the test.
 */
/*
 * ROADMAP S-9. reviews.modelTier was documented as the tier the model assigned
 * and was set from pairs.tier, which is a reviewer's tier after any earlier
 * decision. One column, two meanings, and the second one let the hash chain
 * assert the model had reached T3.
 */
describe("prior tier and model tier are different facts", () => {
  it("records the tier at the decision and the kernel's own tier separately", async () => {
    await readEverything("pair_4f2a");
    const first = await recordDecision({
      session,
      pairId: "pair_4f2a",
      decision: "confirm",
      reasonCode: "confirm.progression_pattern",
      notes: { timeline: "Supervision probe, then a migration ask." },
    });
    expect({ prior: first.review.priorTier, model: first.review.modelTier }).toEqual({
      prior: "T2",
      model: "T2",
    });

    // A second decision on the same pair sits on a reviewer's T2, not a
    // model's. priorTier moves with the pair; modelTier does not.
    const data = await getMockData();
    const pair = data.pairs.find((p) => p.queue.pairId === "pair_4f2a")!;
    pair.queue.resolvedAt = null;
    pair.queue.tier = "T2";
    pair.modelTier = "T1";

    const later = await recordDecision({
      session: second,
      pairId: "pair_4f2a",
      decision: "watch",
      reasonCode: "watch.insufficient_context",
      notes: { timeline: "Holding it while a band is verified." },
    });
    expect({ prior: later.review.priorTier, model: later.review.modelTier }).toEqual({
      prior: "T2",
      model: "T1",
    });
  });

  it("restores the tier the pair carried, not the kernel's", async () => {
    await readEverything("pair_aa19");
    const data = await getMockData();
    const pair = data.pairs.find((p) => p.queue.pairId === "pair_aa19")!;
    pair.modelTier = "T0";

    const decided = await recordDecision({
      session,
      pairId: "pair_aa19",
      decision: "dismiss",
      reasonCode: "dismiss.teen_romance_lawful",
    });
    expect(decided.review.priorTier).toBe("T1");
    expect(decided.review.modelTier).toBe("T0");

    const { restoredTier } = await undoDecision(session, decided.review.id);
    expect(restoredTier).toBe("T1");
    expect(
      (await getMockData()).pairs.find((p) => p.queue.pairId === "pair_aa19")?.queue.tier,
    ).toBe("T1");
  });

  // The chain records what the pair carried, under a name that says so. It used
  // to say modelTier, and on a T3 pair that was the chain asserting the model
  // had reached a tier rule 6 says it cannot.
  it("names the tier on the chain for what it is", async () => {
    await readEverything("pair_aa19");
    const decided = await recordDecision({
      session,
      pairId: "pair_aa19",
      decision: "watch",
      reasonCode: "watch.insufficient_context",
    });
    const entry = (await listAuditEntries(session, { kind: "review.decision", limit: 5 })).find(
      (e) => e.seq === decided.auditSeq,
    );
    expect(entry?.payload.priorTier).toBe("T1");
    expect(entry?.payload).not.toHaveProperty("modelTier");
  });
});

describe("answering a proposal", () => {
  const other = { ...session, reviewerId: "rev_mo", displayName: "M. Osei" };
  const PROPOSAL = "rvw_91c7_propose";

  async function answer(
    who: Session,
    upheld: boolean,
    reasonCode = upheld ? "uphold.independent_agreement" : "overturn.evidence_does_not_support",
  ) {
    return recordDecision({
      session: who,
      pairId: "pair_91c7",
      decision: "report",
      reasonCode,
      notes: { timeline: "Read the timeline myself." },
      concurrence: { proposalReviewId: PROPOSAL, proposerReviewerId: "rev_mo", upheld },
    });
  }

  it("carries the open proposal on the queue row and on the case", async () => {
    const page = await listQueue(session);
    const row = page.cases.find((c) => c.pairId === "pair_91c7");
    expect(row?.proposal?.reviewId).toBe(PROPOSAL);
    expect(row?.proposal?.mine).toBe(false);
    // It sorts above the critical T2, which nothing else in the queue does.
    expect(page.cases[0]!.pairId).toBe("pair_91c7");
  });

  it("writes T3 when a second reviewer upholds it, and closes the proposal", async () => {
    await readEverything("pair_91c7");
    const result = await answer(session, true);
    expect(result.resultTier).toBe("T3");
    expect(result.state).toBe("upheld");

    const data = await getMockData();
    expect(data.reviews.find((r) => r.id === PROPOSAL)?.state).toBe("upheld");
    expect(data.pairs.find((p) => p.queue.pairId === "pair_91c7")?.queue.proposal).toBeNull();
  });

  it("returns the pair to T2 on an overturn, and writes no report", async () => {
    await readEverything("pair_91c7");
    const result = await answer(session, false);
    expect(result.resultTier).toBe("T2");
    expect(result.state).toBe("overturned");
  });

  it("refuses the proposer answering their own proposal", async () => {
    await readEverything("pair_91c7", other);
    await expect(answer(other, true)).rejects.toMatchObject({
      code: "t3_requires_second_person",
    });
  });

  /*
   * Pair.humanViewedAt is set by whoever read first and records nobody, so a
   * concurrence that trusted it would be the proposer reading twice.
   */
  it("refuses a concurrence from a reviewer who has read nothing themselves", async () => {
    await readEverything("pair_91c7", other);
    await expect(answer(session, true)).rejects.toMatchObject({
      code: "concurrence_without_own_read",
    });
  });

  it("refuses a second answer to a proposal somebody already answered", async () => {
    await readEverything("pair_91c7");
    await answer(session, true);
    await expect(answer(session, true)).rejects.toMatchObject({ code: "proposal_not_open" });
  });

  it("refuses an uphold carried by an overturn reason, and a proposal reason on either", async () => {
    await readEverything("pair_91c7");
    await expect(
      answer(session, true, "overturn.evidence_does_not_support"),
    ).rejects.toMatchObject({ code: "concurrence_side_mismatch" });
    await expect(answer(session, true, "propose.online_enticement")).rejects.toMatchObject({
      code: "proposal_reason_on_concurrence",
    });
  });

  it("refuses a proposal stated in a concurrence reason", async () => {
    await readEverything("pair_4f2a");
    await expect(
      recordDecision({
        session,
        pairId: "pair_4f2a",
        decision: "report",
        reasonCode: "uphold.independent_agreement",
        notes: { timeline: "Supervision probe, then a migration ask." },
      }),
    ).rejects.toMatchObject({ code: "concurrence_reason_without_proposal" });
  });

  it("lets the proposer withdraw, and nobody else", async () => {
    await expect(withdrawProposal(session, PROPOSAL)).rejects.toMatchObject({
      code: "not_your_proposal",
    });
    const { pairId } = await withdrawProposal(other, PROPOSAL);
    expect(pairId).toBe("pair_91c7");

    const data = await getMockData();
    expect(data.reviews.find((r) => r.id === PROPOSAL)?.state).toBe("withdrawn");
    expect(data.pairs.find((p) => p.queue.pairId === "pair_91c7")?.queue.proposal).toBeNull();
  });

  it("refuses a withdrawal of a proposal that has been answered", async () => {
    await readEverything("pair_91c7");
    await answer(session, true);
    await expect(withdrawProposal(other, PROPOSAL)).rejects.toMatchObject({
      code: "proposal_not_open",
    });
  });
});

/**
 * The reviewer's notes are the one free-text channel into a CyberTipline filing
 * that never crosses the ingest edge, and the recommendation note is copied
 * verbatim into the report narrative and into the submitted document. Both
 * checks exist again at the report builder, but refusing there strands an
 * already-recorded T3, so this is where they have to bite.
 *
 * The accusation fixture is assembled from separate words: the source scan in
 * packages/schema walks every .ts file in the workspace and fails on a quoted
 * literal that reads as an accusation, and a test fixture is still a literal.
 */
describe("notes that could not be filed are refused at write time", () => {
  const words = (...parts: string[]): string => parts.join(" ");

  async function record(notes: Record<string, string>): Promise<unknown> {
    await readEverything("pair_aa19");
    return recordDecision({
      session,
      pairId: "pair_aa19",
      decision: "confirm",
      reasonCode: reasonsFor("confirm")[0].code,
      notes: { timeline: "The migration ask lands ten minutes in.", ...notes },
    });
  }

  it("refuses a note carrying what looks like image data (rule 1)", async () => {
    await expect(
      record({ recommendation: `here it is data:image/png;base64,${"A".repeat(64)}` }),
    ).rejects.toThrow(DecisionRefused);
    await expect(record({ recommendation: "Q".repeat(600) })).rejects.toThrow(
      /image or video data/,
    );
  });

  it("refuses a note that labels a person, and says which note (rule 5)", async () => {
    await expect(
      record({ recommendation: words("this", "user", "is", "a", "predator") }),
    ).rejects.toThrow(/recommendation note/);
    await expect(
      record({ timeline: words("a", "confirmed", "groomer,", "on", "the", "timeline") }),
    ).rejects.toThrow(/timeline note/);
  });

  it("records a note that describes the traffic", async () => {
    const result = await record({
      recommendation:
        "First contact to a payment demand inside three hours, and the receiving account stated an age in band on the second message.",
    });
    expect(result).toBeTruthy();
  });
});

/**
 * Rule 7 against an append-only chain. A reviewer's note describes the
 * conversation and often quotes it, and the chain outlives every retention
 * class Guardian has, so the words cannot go on it. The digest keeps what the
 * chain is for: a regulator hashes the note off the review row and compares.
 */
describe("what a decision puts on the chain", () => {
  it("seals the reviewer's notes rather than storing them", async () => {
    await readEverything("pair_4f2a");
    const quoted = "she told him she was 13 and he asked her to send a picture";
    const result = await recordDecision({
      session,
      pairId: "pair_4f2a",
      decision: "confirm",
      reasonCode: "confirm.progression_pattern",
      notes: { timeline: quoted },
    });

    const data = await getMockData();
    const entry = (await data.auditStore.read()).find((e) => e.seq === result.review.auditSeq);
    const payload = JSON.stringify(entry?.payload ?? {});

    expect(payload).not.toContain(quoted);
    expect(payload).not.toContain("she told him");
    const notes = entry?.payload.notes as Record<string, { present: boolean; sha256: string | null }>;
    expect(notes.timeline.present).toBe(true);
    expect(notes.timeline.sha256).toBe(createHash("sha256").update(quoted, "utf8").digest("hex"));
    expect(notes.outsideContext.present).toBe(false);
    expect(notes.outsideContext.sha256).toBeNull();

    // The note itself is still on the review row, which retention deletes.
    expect(result.review.notes.timeline).toBe(quoted);
  });
});
