import { describe, expect, it } from "vitest";
import { AuditLog, MemoryAuditStore, canonicalJson, verifyChain } from "../src/index.js";

const SECRET = "test-secret";

async function seed(n: number) {
  const store = new MemoryAuditStore();
  const log = new AuditLog(store, SECRET);
  for (let i = 0; i < n; i++) {
    await log.append({
      kind: "score.assigned",
      customerId: "cus_1",
      payload: { pair: `p${i}`, tier: "T1" },
      ts: new Date(1_800_000_000_000 + i * 1000),
    });
  }
  return { store, log };
}

describe("canonical json", () => {
  it("is key order independent", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("drops undefined and serializes dates stably", () => {
    expect(canonicalJson({ a: undefined, b: new Date("2026-01-01T00:00:00Z") })).toBe(
      '{"b":"2026-01-01T00:00:00.000Z"}',
    );
  });

  it("refuses values that do not round trip", () => {
    expect(() => canonicalJson({ a: NaN })).toThrow();
  });
});

describe("audit chain", () => {
  it("refuses a placeholder secret", () => {
    expect(() => new AuditLog(new MemoryAuditStore(), "change-me")).toThrow();
    expect(() => new AuditLog(new MemoryAuditStore(), "")).toThrow();
  });

  it("verifies a clean chain", async () => {
    const { log } = await seed(20);
    const result = await log.verify();
    expect(result.ok).toBe(true);
    expect(result.ok && result.checked).toBe(20);
  });

  it("links each entry to the one before it", async () => {
    const { store } = await seed(3);
    const entries = await store.read();
    expect(entries[1]!.prevHash).toBe(entries[0]!.hash);
    expect(entries[0]!.prevHash).toBe("0".repeat(64));
  });

  // DESIGN.md section 10: tamper a stored evidence row, verification fails and names the row.
  it("names the row when a payload is edited", async () => {
    const { store, log } = await seed(10);
    store.tamper(6, (e) => {
      e.payload = { pair: "p5", tier: "T0" };
    });
    const result = await log.verify();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.brokenAt).toBe(6);
    expect(result.reason).toBe("hash_mismatch");
    expect(result.detail).toContain("6");
  });

  it("catches a re-hashed row because the next link no longer matches", async () => {
    const { store, log } = await seed(10);
    const entries = await store.read();
    const target = entries[5]!;
    // An attacker with the row but not the secret cannot produce a valid hash.
    store.tamper(6, (e) => {
      e.payload = { pair: "p5", tier: "T0" };
      e.hash = "f".repeat(64);
    });
    const result = await log.verify();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.brokenAt).toBe(target.seq);
  });

  it("catches a deleted row as a sequence gap", async () => {
    const { store } = await seed(5);
    const entries = await store.read();
    const withHole = [entries[0]!, entries[1]!, entries[3]!, entries[4]!];
    const result = verifyChain(withHole, SECRET, "0".repeat(64));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("sequence_gap");
    expect(result.brokenAt).toBe(4);
  });

  it("catches a truncated head", async () => {
    const { store } = await seed(5);
    const entries = await store.read();
    const result = verifyChain(entries.slice(2), SECRET, "0".repeat(64));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("root_mismatch");
  });

  it("rejects a chain verified with the wrong secret", async () => {
    const { store } = await seed(4);
    const entries = await store.read();
    const result = verifyChain(entries, "other-secret", "0".repeat(64));
    expect(result.ok).toBe(false);
  });

  it("verifies a partial range without knowing the earlier history", async () => {
    const { log } = await seed(10);
    const result = await log.verify(5);
    expect(result.ok).toBe(true);
    expect(result.ok && result.checked).toBe(6);
  });

  it("reports the head hash so an evidence bundle can anchor to it", async () => {
    const { store, log } = await seed(3);
    const entries = await store.read();
    const head = await log.head();
    expect(head.hash).toBe(entries[2]!.hash);
    expect(head.seq).toBe(3);
  });
});
