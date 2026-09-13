import { describe, expect, it } from "vitest";
import { accountName, whoAndWhen } from "./words";

const HASH = "6d2936f0a7c4f8b47ab8b8e85ffcffe1d0a9f1f7f8a49109084961d1c090f8b7";

describe("accountName", () => {
  it("uses the name Discord shows when Guardian kept one", () => {
    expect(accountName(HASH, "ryan_xx99")).toBe("ryan_xx99");
  });

  it("falls back to a short form of the hash, never the whole hash", () => {
    expect(accountName(HASH, null)).toBe("c090f8b7");
    expect(accountName(HASH, "   ")).toBe("c090f8b7");
    expect(accountName(HASH, null)).not.toBe(HASH);
  });
});

describe("whoAndWhen", () => {
  it("names both accounts by their kept names", () => {
    const line = whoAndWhen(
      {
        actorUid: HASH,
        targetUid: HASH.replace("6d", "2c"),
        actorName: "ryan_xx99",
        targetName: "kai_b",
        channel: "#general",
        createdAt: new Date("2026-09-13T12:00:00Z"),
      },
      new Date("2026-09-13T13:00:00Z"),
    );
    expect(line).toMatch(/^ryan_xx99 to kai_b in #general/);
    expect(line).not.toContain("c090f8b7");
  });
});
