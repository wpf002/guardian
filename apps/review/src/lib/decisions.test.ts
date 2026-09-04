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
import { markExcerptsViewed } from "./data/cases";
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
async function readEverything(pairId: string): Promise<string[]> {
  const data = await getMockData();
  const pair = data.pairs.find((p) => p.queue.pairId === pairId);
  const rows = pair?.timeline.state === "ready" ? pair.timeline.rows : [];
  return markExcerptsViewed(session, pairId, rows.map((row) => row.id));
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

  it("refuses to restore a T3 pair through undo", async () => {
    // A decision on a pair the model left at T3 is the only way to reach an
    // undo that would put one back, and undo is not the retraction path.
    await readEverything("pair_c5e1");
    const result = await recordDecision({
      session,
      pairId: "pair_c5e1",
      decision: "watch",
      reasonCode: "watch.insufficient_context",
    });
    await expect(undoDecision(session, result.review.id)).rejects.toMatchObject({
      code: "cannot_restore_t3",
    });
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
