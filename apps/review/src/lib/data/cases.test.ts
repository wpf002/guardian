import { beforeEach, describe, expect, it } from "vitest";
import { mockSession } from "../auth";
import { getMockData, resetMockData } from "../mock/fixtures";
import { getAuditEntry, listAuditEntries, verifyAuditChain } from "./audit";
import { getCase, getTimeline, listQueue, markExcerptsViewed } from "./cases";
import { getDashboardSummary } from "./dashboard";
import { getGuildConfig, listGuildConfigs, updateGuildConfig } from "./guilds";
import { getCustomerSettings, updateLexiconExtension } from "./settings";

const session = mockSession();
const otherCustomer = { ...session, customerId: "cus_someone_else" };

beforeEach(() => {
  resetMockData();
});

describe("the queue", () => {
  it("returns unresolved pairs for this customer, ranked", async () => {
    const page = await listQueue(session);
    expect(page.cases.length).toBeGreaterThan(0);
    expect(page.cases.every((c) => c.customerId === session.customerId)).toBe(true);
    expect(page.cases[0]!.tier).toBe("T2");
    expect(page.summary.total).toBe(page.cases.length);
  });

  it("returns nothing for a customer the session does not belong to", async () => {
    const page = await listQueue(otherCustomer);
    expect(page.cases).toEqual([]);
    expect(page.summary.lastArrivalAt).toBeNull();
  });

  it("names the unfiltered count when a filter empties the list", async () => {
    const all = await listQueue(session);
    const critical = await listQueue(session, { chip: "critical" });
    expect(critical.summary.total).toBe(all.summary.total);
    expect(critical.cases.every((c) => c.criticalSignals.length > 0)).toBe(true);
  });

  it("prints no SLA for a watch tier", async () => {
    const page = await listQueue(session);
    const watch = page.cases.find((c) => c.tier === "T1");
    expect(watch?.slaRemainingMinutes).toBeNull();
  });
});

describe("a case", () => {
  it("carries the strip facts, the why sentence and the provenance", async () => {
    const detail = await getCase(session, "pair_4f2a");
    expect(detail).not.toBeNull();
    expect(detail!.queue.criticalSignals).toContain("threat_template");
    expect(detail!.whySentence.length).toBeGreaterThan(0);
    expect(detail!.versions.lexiconVersion).toBe("v2");
    expect(detail!.auditSeq).toBeGreaterThan(0);
  });

  it("is not found for another customer, rather than refused", async () => {
    expect(await getCase(otherCustomer, "pair_4f2a")).toBeNull();
  });

  it("carries a media row as a hash and a verdict, and never any bytes", async () => {
    const timeline = await getTimeline(session, "pair_4f2a");
    expect(timeline.state).toBe("ready");
    if (timeline.state !== "ready") return;
    const media = timeline.rows.find((row) => row.media !== null);
    expect(media?.media?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(media?.media?.verdict).toBe("no_match");
    expect(JSON.stringify(timeline)).not.toContain("data:image");
  });

  it("reports an expired timeline as a designed state rather than an error", async () => {
    const timeline = await getTimeline(session, "pair_3c88");
    expect(timeline.state).toBe("expired");
  });
});

describe("the viewedByHuman write", () => {
  it("marks only the excerpts it was given, and never on case open", async () => {
    const before = await getTimeline(session, "pair_4f2a");
    if (before.state !== "ready") throw new Error("expected a ready timeline");
    expect(before.rows.every((row) => row.viewedByHuman === false)).toBe(true);

    // The ids it actually wrote, not a count: the caller has to reconcile
    // against them rather than assume its whole request landed.
    const marked = await markExcerptsViewed(session, "pair_4f2a", [before.rows[0]!.id]);
    expect(marked).toEqual([before.rows[0]!.id]);

    const after = await getTimeline(session, "pair_4f2a");
    if (after.state !== "ready") throw new Error("expected a ready timeline");
    expect(after.rows.filter((row) => row.viewedByHuman).length).toBe(1);
  });

  it("returns nothing the second time, so a repeat cannot inflate a read count", async () => {
    const before = await getTimeline(session, "pair_4f2a");
    if (before.state !== "ready") throw new Error("expected a ready timeline");
    const id = before.rows[0]!.id;
    expect(await markExcerptsViewed(session, "pair_4f2a", [id])).toEqual([id]);
    expect(await markExcerptsViewed(session, "pair_4f2a", [id])).toEqual([]);
  });

  it("clears the unread marker, which is derived from the same fact", async () => {
    const before = await listQueue(session);
    expect(before.cases.find((row) => row.pairId === "pair_4f2a")?.unread).toBe(true);

    const timeline = await getTimeline(session, "pair_4f2a");
    if (timeline.state !== "ready") throw new Error("expected a ready timeline");
    await markExcerptsViewed(session, "pair_4f2a", [timeline.rows[0]!.id]);

    const after = await listQueue(session);
    expect(after.cases.find((row) => row.pairId === "pair_4f2a")?.unread).toBe(false);
  });

  it("puts the read on the audit chain, because it is the private-search claim", async () => {
    const timeline = await getTimeline(session, "pair_4f2a");
    if (timeline.state !== "ready") throw new Error("expected a ready timeline");
    const id = timeline.rows[0]!.id;
    await markExcerptsViewed(session, "pair_4f2a", [id]);

    const entries = await listAuditEntries(session, { kind: "evidence.read", limit: 10 });
    expect(entries.length).toBe(1);
    expect(entries[0]!.payload.pairId).toBe("pair_4f2a");
    expect(entries[0]!.payload.excerptIds).toEqual([id]);
  });

  it("writes nothing for a case in another partition", async () => {
    expect(await markExcerptsViewed(otherCustomer, "pair_4f2a", ["pair_4f2a_row_0"])).toEqual([]);
  });
});

describe("the aggregate surface", () => {
  it("counts pairs and never people, and withholds a rate below the sample size", async () => {
    const summary = await getDashboardSummary(session);
    expect(summary.pairsByTier.T2).toBeGreaterThan(0);
    expect(summary.t2PositivePredictiveValue).toBeNull();
    expect(Object.keys(summary)).not.toContain("reviewerPace");
  });

  /**
   * DESIGN.md 10 sets the pass mark at two reviewer minutes per 1,000 users per
   * day. The minutes are a window total, so the window has to be divided out:
   * without it the seven day figure was seven times its own label and a
   * partition inside the target read as a failure.
   */
  it("reports reviewer minutes per day, not per window", async () => {
    const week = await getDashboardSummary(session, { windowDays: 7, activeUsers: 4200 });
    const fortnight = await getDashboardSummary(session, { windowDays: 14, activeUsers: 4200 });

    // Same decisions, twice the window, so at most half the daily rate. An
    // undivided total would return the identical number for both.
    expect(week.reviewerMinutesPer1kUsers).not.toBeNull();
    expect(fortnight.reviewerMinutesPer1kUsers).not.toBe(week.reviewerMinutesPer1kUsers);
    expect(fortnight.reviewerMinutesPer1kUsers!).toBeLessThan(week.reviewerMinutesPer1kUsers!);

    const minutes = (await getMockData()).reviews
      .filter((r) => r.createdAt >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
      .reduce((sum, r) => sum + (r.minutesSpent ?? 0), 0);
    expect(week.reviewerMinutesPer1kUsers).toBeCloseTo(
      Math.round((minutes / 7 / 4200) * 1000 * 10) / 10,
      5,
    );
  });

  /**
   * "Realized T2 predictive value" is about T2. Dividing by every decision in
   * the window diluted it with T1 and T3 work, so the number the operator reads
   * against the 40% target described nothing.
   */
  it("counts only decisions on model-T2 pairs toward the T2 predictive value", async () => {
    const summary = await getDashboardSummary(session, { windowDays: 30 });
    const reviews = (await getMockData()).reviews.filter(
      (r) => r.createdAt >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    );
    const t2 = reviews.filter((r) => r.modelTier === "T2");

    expect(reviews.length).toBeGreaterThan(t2.length);
    expect(summary.decisionsSampleSize).toBe(t2.length);
  });

  /**
   * The tier bars exist to compare two windows. The mock branch ignored the
   * window entirely, so seven days and thirty days printed the same rows in
   * every development and screenshot build.
   */
  it("applies the window to the tier counts", async () => {
    const day = await getDashboardSummary(session, { windowDays: 1 });
    const year = await getDashboardSummary(session, { windowDays: 365 });
    const total = (counts: typeof day.pairsByTier) =>
      Object.values(counts).reduce((a, b) => a + b, 0);

    expect(total(year.pairsByTier)).toBeGreaterThan(total(day.pairsByTier));
  });
});

describe("guild configuration", () => {
  it("reads and writes only rows this customer owns", async () => {
    const rows = await listGuildConfigs(session);
    expect(rows.length).toBeGreaterThan(0);
    expect(await listGuildConfigs(otherCustomer)).toEqual([]);

    const updated = await updateGuildConfig(session, rows[0]!.guildId, { enabled: false });
    expect(updated?.enabled).toBe(false);
    expect(await updateGuildConfig(otherCustomer, rows[0]!.guildId, { enabled: true })).toBeNull();
    expect((await getGuildConfig(session, rows[0]!.guildId))?.enabled).toBe(false);
  });
});

describe("settings", () => {
  it("returns the customer's own lexicon extension and nobody else's", async () => {
    const settings = await getCustomerSettings(session);
    expect(settings?.customerId).toBe(session.customerId);
    expect(await getCustomerSettings(otherCustomer)).toBeNull();

    const written = await updateLexiconExtension(session, { version: "northwood-2" });
    expect(written.version).toBe("northwood-2");
  });
});

describe("the audit chain", () => {
  it("holds a verifiable chain and reads one entry at a time", async () => {
    const entries = await listAuditEntries(session, { limit: 40 });
    expect(entries.length).toBe(40);
    const first = await getAuditEntry(session, entries[entries.length - 1]!.seq);
    expect(first?.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await verifyAuditChain()).toMatchObject({ ok: true });
  });

  it("returns nothing for another customer's sequence number", async () => {
    expect(await getAuditEntry(otherCustomer, 1)).toBeNull();
  });
});
