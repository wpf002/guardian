import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { mockSession } from "./auth";
import {
  DecisionRefused,
  REASONS,
  reasonsFor,
  recordDecision,
  resolveResultTier,
  undoDecision,
} from "./decisions";
import { getMockData, resetMockData } from "./mock/fixtures";

const session = mockSession();
const second = { ...session, reviewerId: "rev_second", displayName: "M. Osei" };

beforeEach(() => {
  resetMockData();
});

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
    const proposal = await recordDecision({
      session,
      pairId: "pair_4f2a",
      decision: "report",
      reasonCode: "propose.online_enticement",
      notes: { timeline: "Supervision probe, then a migration ask 4 minutes later." },
    });

    const upheld = await recordDecision({
      session: second,
      pairId: "pair_4f2a",
      decision: "report",
      reasonCode: "propose.online_enticement",
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
        reasonCode: "propose.online_enticement",
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

  it("refuses to restore T3 through undo", async () => {
    const result = await recordDecision({
      session,
      pairId: "pair_aa19",
      decision: "watch",
      reasonCode: "watch.insufficient_context",
    });
    await expect(undoDecision(session, result.review.id, "T3")).rejects.toMatchObject({
      code: "cannot_restore_t3",
    });
  });

  it("undo restores the tier and appends a compensating entry without editing the row", async () => {
    const result = await recordDecision({
      session,
      pairId: "pair_aa19",
      decision: "dismiss",
      reasonCode: "dismiss.economy_transaction",
    });
    const undone = await undoDecision(session, result.review.id, "T1");
    expect(undone.auditSeq).toBeGreaterThan(result.auditSeq);

    const data = await getMockData();
    const pair = data.pairs.find((p) => p.queue.pairId === "pair_aa19");
    expect(pair?.queue.tier).toBe("T1");
    expect(data.reviews.find((r) => r.id === result.review.id)?.resultTier).toBe("T0");
  });
});

/**
 * CLAUDE.md rule 6, as a test rather than a promise. If a new file needs to
 * write tier T3, this fails, and adding it to the allowlist is a code review
 * about the one rule the product cannot get wrong.
 */
describe("the only T3 write path", () => {
  // vitest runs from the package root, and import.meta.url is not a file URL
  // under jsdom, so the walk starts from the package instead.
  const srcRoot = resolve(process.cwd(), "src");
  const ALLOWED = new Set(["lib/decisions.ts", "lib/decisions.test.ts", "lib/mock/fixtures.ts"]);
  const TIER_WRITE = /\b(tier|resultTier|modelTier|restoreTier)\s*:\s*["']T3["']/;

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

  it("is decisions.ts, and nothing else in this app assigns tier T3", () => {
    const offenders = walk(srcRoot).filter(
      (rel) => !ALLOWED.has(rel) && TIER_WRITE.test(readFileSync(join(srcRoot, rel), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps the allowlist to the decision module, its test and the fixtures", () => {
    expect([...ALLOWED].sort()).toEqual([
      "lib/decisions.test.ts",
      "lib/decisions.ts",
      "lib/mock/fixtures.ts",
    ]);
  });
});
