import { beforeEach, describe, expect, it } from "vitest";
import { mockSession } from "../auth";
import { resetMockData } from "../mock/fixtures";
import { getAuditEntry, hasReadEvidence, listAuditEntries, verifyAuditChain } from "./audit";
import { getCase, getTimeline, listQueue, markExcerptsViewed } from "./cases";
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
    expect(page.cases[0].tier).toBe("T2");
    expect(page.summary.total).toBe(page.cases.length);
  });

  it("returns nothing for a customer the session does not belong to", async () => {
    const page = await listQueue(otherCustomer);
    expect(page.cases).toEqual([]);
    expect(page.summary.lastArrivalAt).toBeNull();
  });

  // The queue hides nothing. The chip filters that used to sit above it are
  // gone, so the list a reviewer sees is every unresolved case in the partition
  // and the summary count is the length of that list, never a larger number.
  it("hides no case behind a filter", async () => {
    const page = await listQueue(session);
    expect(page.summary.total).toBe(page.cases.length);
    expect(page.cases.some((c) => c.criticalSignals.length === 0)).toBe(true);
  });

  it("ranks the more serious cases above the rest", async () => {
    const page = await listQueue(session);
    const tiers = page.cases.map((c) => c.tier);
    const lastT2 = tiers.lastIndexOf("T2");
    const firstT1 = tiers.indexOf("T1");
    expect(firstT1).toBeGreaterThan(lastT2);
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
    const marked = await markExcerptsViewed(session, "pair_4f2a", [before.rows[0].id]);
    expect(marked).toEqual([before.rows[0].id]);

    const after = await getTimeline(session, "pair_4f2a");
    if (after.state !== "ready") throw new Error("expected a ready timeline");
    expect(after.rows.filter((row) => row.viewedByHuman).length).toBe(1);
  });

  /*
   * The flag is first-wins and the chain entry is per reviewer.
   *
   * viewedByHuman is one boolean per excerpt with no reviewer on it, so a
   * second reviewer reading a case the proposer already read moves no flag. It
   * still has to leave a record, because the chain is the only place that says
   * who read what and a concurrence turns on the second person having read it
   * themselves. So a repeat returns the ids and does not double the flags.
   */
  it("does not move the flag on a repeat read, and still records the reader", async () => {
    const before = await getTimeline(session, "pair_4f2a");
    if (before.state !== "ready") throw new Error("expected a ready timeline");
    const id = before.rows[0].id;
    expect(await markExcerptsViewed(session, "pair_4f2a", [id])).toEqual([id]);
    expect(await markExcerptsViewed(session, "pair_4f2a", [id])).toEqual([id]);

    const after = await getTimeline(session, "pair_4f2a");
    if (after.state !== "ready") throw new Error("expected a ready timeline");
    expect(after.rows.filter((row) => row.viewedByHuman).length).toBe(1);

    const second = { ...session, reviewerId: "rev_second", displayName: "M. Osei" };
    expect(await hasReadEvidence(second, "pair_4f2a")).toBe(false);
    await markExcerptsViewed(second, "pair_4f2a", [id]);
    expect(await hasReadEvidence(second, "pair_4f2a")).toBe(true);
  });

  it("clears the unread marker, which is derived from the same fact", async () => {
    const before = await listQueue(session);
    expect(before.cases.find((row) => row.pairId === "pair_4f2a")?.unread).toBe(true);

    const timeline = await getTimeline(session, "pair_4f2a");
    if (timeline.state !== "ready") throw new Error("expected a ready timeline");
    await markExcerptsViewed(session, "pair_4f2a", [timeline.rows[0].id]);

    const after = await listQueue(session);
    expect(after.cases.find((row) => row.pairId === "pair_4f2a")?.unread).toBe(false);
  });

  it("puts the read on the audit chain, because it is the private-search claim", async () => {
    const timeline = await getTimeline(session, "pair_4f2a");
    if (timeline.state !== "ready") throw new Error("expected a ready timeline");
    const id = timeline.rows[0].id;
    await markExcerptsViewed(session, "pair_4f2a", [id]);

    const entries = await listAuditEntries(session, { kind: "evidence.read", limit: 10 });
    expect(entries.length).toBe(1);
    expect(entries[0].payload.pairId).toBe("pair_4f2a");
    expect(entries[0].payload.excerptIds).toEqual([id]);
  });

  it("writes nothing for a case in another partition", async () => {
    expect(await markExcerptsViewed(otherCustomer, "pair_4f2a", ["pair_4f2a_row_0"])).toEqual([]);
  });
});

/*
 * The aggregate surface went with the Reporting page. getDashboardSummary
 * computed flag rates, predictive value and reviewer minutes per thousand
 * members, and nothing reads it any more: every number it produced measured
 * Guardian rather than describing a child.
 */


describe("guild configuration", () => {
  it("reads and writes only rows this customer owns", async () => {
    const rows = await listGuildConfigs(session);
    expect(rows.length).toBeGreaterThan(0);
    expect(await listGuildConfigs(otherCustomer)).toEqual([]);

    const updated = await updateGuildConfig(session, rows[0].guildId, { enabled: false });
    expect(updated?.enabled).toBe(false);
    expect(await updateGuildConfig(otherCustomer, rows[0].guildId, { enabled: true })).toBeNull();
    expect((await getGuildConfig(session, rows[0].guildId))?.enabled).toBe(false);
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
    const first = await getAuditEntry(session, entries[entries.length - 1].seq);
    expect(first?.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await verifyAuditChain()).toMatchObject({ ok: true });
  });

  it("returns nothing for another customer's sequence number", async () => {
    expect(await getAuditEntry(otherCustomer, 1)).toBeNull();
  });
});
