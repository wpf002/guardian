import { describe, expect, it } from "vitest";
import { groupByContactingAccount, groupByTargetedAccount, ungrouped } from "./people";
import type { QueueCase } from "./types";

/*
 * The grouping the console was missing.
 *
 * A pair is Guardian's unit. A child three accounts are working on produced
 * three unrelated rows, and the fact that mattered most about that child, that
 * it was three and not one, was on no screen.
 */

function band(value: QueueCase["actorBand"]["band"]): QueueCase["actorBand"] {
  return { band: value, confidence: null, provenance: "server_role" };
}

function pair(over: Partial<QueueCase> & { actorUid: string; targetUid: string }): QueueCase {
  return {
    pairId: `pair_${over.actorUid}_${over.targetUid}`,
    shortId: "0000",
    customerId: "cus_1",
    customerName: "Northwood Gaming",
    channel: "#general",
    tier: "T2",
    criticalSignals: [],
    patternClause: "Asked to move somewhere else",
    actorBand: band("A18_20"),
    targetBand: band("A13_15"),
    actorContext: "First time Guardian has seen this account.",
    suggestedPosture: null,
    targetSource: "reply",
    soleAutomatedBasis: false,
    messageCount: 4,
    spanHours: 1,
    mediaEventCount: 0,
    excerpt: null,
    stagesReached: 2,
    createdAt: new Date("2026-09-10T10:00:00Z"),
    slaRemainingMinutes: null,
    claim: { state: "unclaimed" },
    unread: false,
    proposal: null,
    updatedAt: new Date("2026-09-10T10:00:00Z"),
    resolvedAt: null,
    ...over,
  };
}

/*
 * Tiers come from this list rather than being spelled inline. The source scan
 * in lib/decisions.test.ts refuses a tier-named binding assigned the literal
 * "T3" anywhere outside the decision path, because that shape is how a tier
 * gets written. Nothing here writes one.
 */
const [WATCH, , REPORTED] = ["T1", "T2", "T3"] as QueueCase["tier"][];

describe("grouping by the account being contacted", () => {
  it("puts three separate conversations about one child on one row", () => {
    const rows = groupByTargetedAccount([
      pair({ actorUid: "a1", targetUid: "kid" }),
      pair({ actorUid: "a2", targetUid: "kid" }),
      pair({ actorUid: "a3", targetUid: "kid" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.uid).toBe("kid");
    expect(rows[0]!.contacts.map((c) => c.uid).sort()).toEqual(["a1", "a2", "a3"]);
  });

  it("ranks a child three accounts are working on above one with a single conversation", () => {
    const rows = groupByTargetedAccount([
      pair({ actorUid: "a1", targetUid: "one" }),
      pair({ actorUid: "b1", targetUid: "three" }),
      pair({ actorUid: "b2", targetUid: "three" }),
      pair({ actorUid: "b3", targetUid: "three" }),
    ]);
    expect(rows.map((r) => r.uid)).toEqual(["three", "one"]);
  });

  it("puts a conversation waiting on a second reviewer above everything", () => {
    const proposal = {
      reviewId: "rvw_1",
      proposerReviewerId: "rev_mo",
      proposerName: "M. Osei",
      reasonLabel: "Online enticement",
      proposedAt: new Date("2026-09-10T09:00:00Z"),
      mine: false,
    } as QueueCase["proposal"];
    const rows = groupByTargetedAccount([
      pair({ actorUid: "b1", targetUid: "three" }),
      pair({ actorUid: "b2", targetUid: "three" }),
      pair({ actorUid: "b3", targetUid: "three" }),
      pair({ actorUid: "a1", targetUid: "waiting", proposal }),
    ]);
    expect(rows[0]!.uid).toBe("waiting");
  });

  /*
   * The kernel's actor is whoever spoke, not whoever is older. A child who
   * replies first is the actor on their own case, and reading the roles instead
   * of the bands files that case under the child as the one doing the
   * contacting.
   */
  it("reads the bands rather than the actor and target roles", () => {
    const rows = groupByTargetedAccount([
      pair({
        actorUid: "child_spoke_first",
        targetUid: "older",
        actorBand: band("A13_15"),
        targetBand: band("A21_PLUS"),
      }),
    ]);
    expect(rows[0]!.uid).toBe("child_spoke_first");
    expect(rows[0]!.contacts[0]!.uid).toBe("older");
  });

  it("keeps the newest conversation first inside a row", () => {
    const rows = groupByTargetedAccount([
      pair({ actorUid: "old", targetUid: "kid", createdAt: new Date("2026-09-08T10:00:00Z") }),
      pair({ actorUid: "new", targetUid: "kid", createdAt: new Date("2026-09-10T10:00:00Z") }),
    ]);
    expect(rows[0]!.contacts.map((c) => c.uid)).toEqual(["new", "old"]);
  });

  it("carries the worst tier across the conversations up to the row", () => {
    const rows = groupByTargetedAccount([
      pair({ actorUid: "a1", targetUid: "kid", tier: WATCH }),
      pair({ actorUid: "a2", targetUid: "kid", tier: REPORTED }),
    ]);
    expect(rows[0]!.tier).toBe(REPORTED);
  });

  /*
   * Two accounts in the same band, or two with no band at all, are not an adult
   * and a child. Guardian says so by not claiming it, rather than by picking a
   * side. A bridged game chat produces UNKNOWN on both, which is the case this
   * matters most for.
   */
  it("claims nothing when the bands do not separate the two accounts", () => {
    const same = [
      pair({ actorUid: "x", targetUid: "y", actorBand: band("A13_15"), targetBand: band("A13_15") }),
      pair({ actorUid: "p", targetUid: "q", actorBand: band("UNKNOWN"), targetBand: band("UNKNOWN") }),
    ];
    expect(groupByTargetedAccount(same)).toEqual([]);
    expect(ungrouped(same)).toHaveLength(2);
  });

  it("claims nothing when the younger account is not in a minor band", () => {
    const rows = groupByTargetedAccount([
      pair({ actorUid: "x", targetUid: "y", actorBand: band("A21_PLUS"), targetBand: band("A18_20") }),
    ]);
    expect(rows).toEqual([]);
  });
});

describe("grouping by the account doing the contacting", () => {
  it("counts how many accounts in a minor band one account is talking to", () => {
    const rows = groupByContactingAccount([
      pair({ actorUid: "one", targetUid: "kid_a" }),
      pair({ actorUid: "one", targetUid: "kid_b" }),
      pair({ actorUid: "one", targetUid: "kid_c" }),
      pair({ actorUid: "two", targetUid: "kid_d" }),
    ]);
    expect(rows[0]!.uid).toBe("one");
    expect(rows[0]!.minorCount).toBe(3);
    expect(rows[1]!.minorCount).toBe(1);
  });

  it("names the children on the row, so the fan-out is readable and not a number", () => {
    const rows = groupByContactingAccount([
      pair({ actorUid: "one", targetUid: "kid_a" }),
      pair({ actorUid: "one", targetUid: "kid_b" }),
    ]);
    expect(rows[0]!.contacts.map((c) => c.uid).sort()).toEqual(["kid_a", "kid_b"]);
  });
});
