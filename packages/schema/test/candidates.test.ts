import { describe, expect, it } from "vitest";
import { loadLexicon } from "../src/lexicon.js";
import {
  FEEDBACK_LIMITS,
  FeedbackRateLimiter,
  isSuppressionList,
  recordCandidate,
  screenFeedback,
  type FeedbackAccepted,
} from "../src/candidates.js";

const lexicon = loadLexicon();
const T0 = new Date("2026-09-04T12:00:00Z");

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    byUid: "a".repeat(64),
    surface: "hop on vc",
    proposedList: "migration.platform",
    source: "moderator" as const,
    at: T0,
    ...overrides,
  };
}

/**
 * ROADMAP F-2. The dismissal control in a mod channel is open to anyone with
 * the permission in a guild, so it is a write path into detection that a guild
 * could otherwise use to make Guardian blind to a phrase.
 */
describe("screenFeedback", () => {
  it("accepts an ordinary phrase and returns the form the loop keys on", () => {
    const verdict = screenFeedback(proposal(), new FeedbackRateLimiter(), lexicon);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.normalized).toBe("hop on vc");
    expect(verdict.surface).toBe("hop on vc");
  });

  it("normalizes through the versioned normalizer, so an emoji code is a phrase", () => {
    const verdict = screenFeedback(proposal({ surface: "add me on 👻" }), new FeedbackRateLimiter(), lexicon);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.normalized).toContain("snapchat");
  });

  /**
   * The one that matters. An exemption list is where a detector is told to look
   * away, and a moderator who can add to one can turn a detector off for their
   * own guild by describing the thing it detects.
   */
  it("refuses a proposal for an exemption list, because adding is blinding", () => {
    for (const list of ["exemptions", "suppression.support", "negations", "reported_speech"]) {
      const verdict = screenFeedback(proposal({ proposedList: list }), new FeedbackRateLimiter(), lexicon);
      expect(verdict.ok).toBe(false);
      if (verdict.ok) continue;
      expect(verdict.code).toBe("suppression_list");
    }
    expect(isSuppressionList("migration.platform")).toBe(false);
  });

  it("refuses a message pasted in as a phrase", () => {
    const verdict = screenFeedback(
      proposal({ surface: "x".repeat(FEEDBACK_LIMITS.maxPhraseChars + 1) }),
      new FeedbackRateLimiter(),
      lexicon,
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe("too_long");
  });

  it("refuses something that normalizes to nothing", () => {
    const verdict = screenFeedback(proposal({ surface: "!!! ??? ..." }), new FeedbackRateLimiter(), lexicon);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe("not_a_phrase");
  });

  it("never quotes what the writer wrote back at them", () => {
    const secret = "a phrase that should not be echoed";
    const verdict = screenFeedback(
      proposal({ proposedList: "exemptions", surface: secret }),
      new FeedbackRateLimiter(),
      lexicon,
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).not.toContain(secret);
  });
});

describe("the per-writer budget", () => {
  it("stops one account after its budget and lets another through", () => {
    const limiter = new FeedbackRateLimiter(3, 60_000);
    const me = proposal({ byUid: "a".repeat(64) });
    const you = proposal({ byUid: "b".repeat(64) });

    for (let i = 0; i < 3; i += 1) {
      expect(screenFeedback({ ...me, surface: `phrase ${i}` }, limiter, lexicon).ok).toBe(true);
    }
    const refused = screenFeedback({ ...me, surface: "one more" }, limiter, lexicon);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe("rate_limited");

    expect(screenFeedback(you, limiter, lexicon).ok).toBe(true);
  });

  it("lets the writer back in once the window has passed", () => {
    const limiter = new FeedbackRateLimiter(1, 60_000);
    const first = proposal();
    expect(screenFeedback(first, limiter, lexicon).ok).toBe(true);
    expect(screenFeedback({ ...first, at: new Date(T0.getTime() + 1_000) }, limiter, lexicon).ok).toBe(
      false,
    );
    expect(
      screenFeedback({ ...first, at: new Date(T0.getTime() + 61_000) }, limiter, lexicon).ok,
    ).toBe(true);
  });

  it("spends nothing on a proposal that was refused before the budget check", () => {
    const limiter = new FeedbackRateLimiter(1, 60_000);
    expect(screenFeedback(proposal({ proposedList: "exemptions" }), limiter, lexicon).ok).toBe(false);
    // The budget was untouched, so the writer's one real proposal still lands.
    expect(screenFeedback(proposal(), limiter, lexicon).ok).toBe(true);
  });

  it("forgets a writer whose window has passed", () => {
    const limiter = new FeedbackRateLimiter(1, 60_000);
    screenFeedback(proposal(), limiter, lexicon);
    limiter.prune(T0.getTime() + 120_000);
    expect(screenFeedback({ ...proposal(), at: new Date(T0.getTime() + 120_000) }, limiter, lexicon).ok).toBe(
      true,
    );
  });
});

describe("recordCandidate", () => {
  it("creates a proposal and increments a second sighting rather than adding a row", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const delegate = {
      async upsert(args: Record<string, unknown>) {
        calls.push(args);
        return undefined;
      },
    };
    const accepted: FeedbackAccepted = { ok: true, normalized: "hop on vc", surface: "hop on vc" };

    await recordCandidate(delegate as never, { ...proposal(), customerId: "cus_1", lexiconVersion: "v2" }, accepted);

    const args = calls[0] as {
      where: { customerId_proposedList_normalized: Record<string, string> };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(args.where.customerId_proposedList_normalized).toEqual({
      customerId: "cus_1",
      proposedList: "migration.platform",
      normalized: "hop on vc",
    });
    expect(args.create.source).toBe("moderator");
    expect(args.create.occurrences).toBe(1);
    expect(args.update).toEqual({ occurrences: { increment: 1 }, lastSeenAt: T0 });
    // Nothing here sets a status. A candidate is a proposal, and only a person
    // cutting a new lexicon version promotes one.
    expect(args.create.status).toBeUndefined();
    expect(args.update.status).toBeUndefined();
  });
});
