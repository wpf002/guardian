import { describe, expect, it } from "vitest";
import { prismaRetentionDelegate, type PrismaLike } from "../src/retention-job.js";

/*
 * Account names are kept only while the account is in a conversation Guardian
 * flagged, and deleted on the same schedule as that conversation. These run
 * the real delegate against a small in-memory table that answers the where
 * clauses it sends, so what is tested is which rows go, not which calls were
 * made.
 */

type Retention = "EPHEMERAL_24H" | "WATCH_30D" | "CASE_1Y" | "LEGAL_HOLD";
interface NameRow {
  id: string;
  customerId: string;
  hashedUid: string;
  retention: Retention;
  expiresAt: Date | null;
}
interface PairRow {
  customerId: string;
  actorUid: string;
  targetUid: string;
  tier: "T0" | "T1" | "T2" | "T3";
}

function world(names: NameRow[], pairs: PairRow[], pageSize?: number) {
  const table = [...names];
  const inList = (value: unknown, where: unknown) =>
    (where as { in?: unknown[] } | undefined)?.in?.includes(value) ?? true;

  const accountName = {
    async deleteMany({ where }: { where: Record<string, unknown> }) {
      const before = table.length;
      for (let i = table.length - 1; i >= 0; i -= 1) {
        const row = table[i]!;
        const byId = where.id ? inList(row.id, where.id) : true;
        const lt = (where.expiresAt as { lt?: Date } | undefined)?.lt;
        const expired = lt ? row.expiresAt !== null && row.expiresAt < lt : true;
        const notHeld = where.retention ? row.retention !== "LEGAL_HOLD" : true;
        if (byId && expired && notHeld) table.splice(i, 1);
      }
      return { count: before - table.length };
    },
    async findMany({ where, take }: { where: Record<string, unknown>; take: number }) {
      const after = (where.id as { gt?: string } | undefined)?.gt ?? "";
      return table
        .filter((row) => row.retention !== "LEGAL_HOLD" && row.id > after)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, pageSize ?? take)
        .map((row) => ({ id: row.id, customerId: row.customerId, hashedUid: row.hashedUid }));
    },
  };

  const pair = {
    async deleteMany() {
      return { count: 0 };
    },
    async findMany({
      where,
      distinct,
      take,
    }: {
      where: Record<string, unknown>;
      distinct?: Array<"actorUid" | "targetUid">;
      take: number;
    }) {
      const rows = pairs.filter(
        (row) =>
          row.customerId === where.customerId &&
          inList(row.tier, where.tier) &&
          inList(row.actorUid, where.actorUid) &&
          inList(row.targetUid, where.targetUid),
      );
      const column = distinct?.[0];
      const seen = new Set<string>();
      const out = column ? rows.filter((row) => !seen.has(row[column]) && seen.add(row[column])) : rows;
      return out.slice(0, take).map((row) => ({ actorUid: row.actorUid, targetUid: row.targetUid }));
    },
  };

  const stub = { deleteMany: async () => ({ count: 0 }) };
  const prisma = {
    event: { ...stub, updateMany: async () => ({ count: 0 }) },
    pair,
    review: stub,
    $transaction: async <T,>(ops: Array<Promise<T>>) => Promise.all(ops),
    actor: stub,
    accountName,
    evidenceBundle: stub,
    webhookDelivery: stub,
  } as unknown as PrismaLike;
  return { delegate: prismaRetentionDelegate(prisma), table };
}

const NOW = new Date("2026-09-13T12:00:00Z");
const LATER = new Date("2026-10-13T12:00:00Z");
const EARLIER = new Date("2026-09-01T12:00:00Z");

function name(id: string, hashedUid: string, over: Partial<NameRow> = {}): NameRow {
  return { id, customerId: "cus_1", hashedUid, retention: "WATCH_30D", expiresAt: LATER, ...over };
}

describe("account name retention", () => {
  it("keeps a name while a flagged conversation names the account, on either side", async () => {
    const { delegate, table } = world(
      [name("n1", "older"), name("n2", "younger")],
      [{ customerId: "cus_1", actorUid: "older", targetUid: "younger", tier: "T2" }],
    );
    expect(await delegate.deleteExpiredNames(NOW)).toBe(0);
    expect(table.map((row) => row.id)).toEqual(["n1", "n2"]);
  });

  it("deletes a name past its expiry", async () => {
    const { delegate, table } = world(
      [name("n1", "older", { expiresAt: EARLIER })],
      [{ customerId: "cus_1", actorUid: "older", targetUid: "younger", tier: "T2" }],
    );
    expect(await delegate.deleteExpiredNames(NOW)).toBe(1);
    expect(table).toEqual([]);
  });

  it("deletes a name the moment no flagged conversation names the account", async () => {
    const { delegate, table } = world(
      [name("n1", "older"), name("n2", "gone")],
      [
        { customerId: "cus_1", actorUid: "older", targetUid: "younger", tier: "T1" },
        // A conversation that scored nothing does not keep a name.
        { customerId: "cus_1", actorUid: "gone", targetUid: "someone", tier: "T0" },
      ],
    );
    expect(await delegate.deleteExpiredNames(NOW)).toBe(1);
    expect(table.map((row) => row.id)).toEqual(["n1"]);
  });

  it("never lets another customer's conversation keep a name", async () => {
    const { delegate, table } = world(
      [name("n1", "same-hash")],
      [{ customerId: "cus_2", actorUid: "same-hash", targetUid: "x", tier: "T3" }],
    );
    expect(await delegate.deleteExpiredNames(NOW)).toBe(1);
    expect(table).toEqual([]);
  });

  it("leaves a name under legal hold alone, whatever its expiry says", async () => {
    const { delegate, table } = world([name("n1", "held", { retention: "LEGAL_HOLD", expiresAt: EARLIER })], []);
    expect(await delegate.deleteExpiredNames(NOW)).toBe(0);
    expect(table).toHaveLength(1);
  });

  /*
   * The bug this shape exists to prevent. A read capped at a row count let one
   * account in many flagged conversations fill the cap, and every other account
   * on the page then looked unnamed and lost its name.
   */
  it("does not let one account in many conversations crowd out the others", async () => {
    const pairs: PairRow[] = [];
    for (let i = 0; i < 40; i += 1) {
      pairs.push({ customerId: "cus_1", actorUid: "busy", targetUid: `kid_${i}`, tier: "T2" });
    }
    pairs.push({ customerId: "cus_1", actorUid: "quiet", targetUid: "kid_q", tier: "T2" });
    const { delegate, table } = world([name("n1", "busy"), name("n2", "quiet")], pairs);
    expect(await delegate.deleteExpiredNames(NOW)).toBe(0);
    expect(table).toHaveLength(2);
  });

  it("checks every name across pages, not just the first page", async () => {
    const names = Array.from({ length: 7 }, (_, i) => name(`n${i}`, `uid_${i}`));
    const pairs: PairRow[] = [{ customerId: "cus_1", actorUid: "uid_0", targetUid: "x", tier: "T1" }];
    const { delegate, table } = world(names, pairs, 2);
    expect(await delegate.deleteExpiredNames(NOW)).toBe(6);
    expect(table.map((row) => row.hashedUid)).toEqual(["uid_0"]);
  });
});
