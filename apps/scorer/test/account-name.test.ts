import { describe, expect, it } from "vitest";
import { persistAccountName, type AccountNamePersistClient } from "../src/persist.js";

/*
 * The name Discord shows for an account, kept only for a flagged conversation.
 * An in-memory table with upsert semantics, keyed the way the real one is.
 */

type Row = { name: string; retention: "EPHEMERAL_24H" | "WATCH_30D" | "CASE_1Y" | "LEGAL_HOLD"; expiresAt: Date | null };

function table() {
  const rows = new Map<string, Row>();
  const key = (k: { customerId: string; hashedUid: string }) => `${k.customerId}|${k.hashedUid}`;
  const db: AccountNamePersistClient = {
    accountName: {
      async findUnique({ where }) {
        const row = rows.get(key(where.customerId_hashedUid));
        return row ? { retention: row.retention, expiresAt: row.expiresAt } : null;
      },
      async upsert({ where, create, update }) {
        const k = key(where.customerId_hashedUid);
        rows.set(k, rows.has(k) ? { ...rows.get(k)!, ...update } : { name: create.name, retention: create.retention, expiresAt: create.expiresAt });
        return undefined;
      },
    },
  };
  return { db, rows };
}

const NOW = new Date("2026-09-13T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const [WATCH, REVIEW, REPORTED] = ["T1", "T2", "T3"] as const;

describe("persistAccountName", () => {
  it("keeps nothing for a conversation that scored nothing", async () => {
    const { db, rows } = table();
    const kept = await persistAccountName(db, { customerId: "c", hashedUid: "h", name: "ryan_xx99", tier: "T0" }, { now: () => NOW });
    expect(kept).toBe(false);
    expect(rows.size).toBe(0);
  });

  it("keeps the name for a flagged conversation, for as long as that conversation", async () => {
    const { db, rows } = table();
    await persistAccountName(db, { customerId: "c", hashedUid: "h", name: "ryan_xx99", tier: REVIEW }, { now: () => NOW });
    const row = rows.get("c|h")!;
    expect(row.name).toBe("ryan_xx99");
    expect(row.retention).toBe("WATCH_30D");
    expect(row.expiresAt?.getTime()).toBe(NOW.getTime() + 30 * DAY);
  });

  it("never shortens a name kept for a reported conversation", async () => {
    const { db, rows } = table();
    await persistAccountName(db, { customerId: "c", hashedUid: "h", name: "ryan_xx99", tier: REPORTED }, { now: () => NOW });
    const later = new Date(NOW.getTime() + DAY);
    await persistAccountName(db, { customerId: "c", hashedUid: "h", name: "ryan_xx99", tier: WATCH }, { now: () => later });
    const row = rows.get("c|h")!;
    // The class stays at a year, and the expiry is the later of the two: the
    // same ratchet every other row follows, so a later flag extends it and
    // nothing ever brings it forward.
    expect(row.retention).toBe("CASE_1Y");
    expect(row.expiresAt!.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + 365 * DAY);
  });

  it("updates the name when it changes in Discord", async () => {
    const { db, rows } = table();
    await persistAccountName(db, { customerId: "c", hashedUid: "h", name: "old nick", tier: REVIEW }, { now: () => NOW });
    await persistAccountName(db, { customerId: "c", hashedUid: "h", name: "new nick", tier: REVIEW }, { now: () => NOW });
    expect(rows.get("c|h")!.name).toBe("new nick");
  });

  it("stores nothing for a blank name, and trims a long one", async () => {
    const { db, rows } = table();
    expect(await persistAccountName(db, { customerId: "c", hashedUid: "h", name: "   ", tier: REVIEW })).toBe(false);
    await persistAccountName(db, { customerId: "c", hashedUid: "h2", name: "x".repeat(200), tier: REVIEW });
    expect(rows.get("c|h2")!.name).toHaveLength(64);
  });
});
