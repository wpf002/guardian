import { AuditLog, MemoryAuditStore } from "@guardian/audit";
import { Kernel, MemoryKernelStore } from "@guardian/scorer";
import { hashUid, newCustomerSalt } from "@guardian/schema";
import { describe, expect, it } from "vitest";
import { guildConfigSchema } from "../src/config.js";
import type { DiscordMessageLike, MemberBand } from "../src/mapping.js";
import { BotPipeline, type Persistence } from "../src/pipeline.js";

/*
 * The name Discord shows for each account in a flagged conversation, so the
 * console can say ryan_xx99 instead of c090f8b7. Names are written only when a
 * conversation reaches T1 or above, keyed by the same salted hash every other
 * row uses.
 */

const GUILD = "guild-1";

function config() {
  return guildConfigSchema.parse({
    guildId: GUILD,
    modChannelId: "chan-mods",
    enabled: true,
    roleBands: { "role-kid": "A9_12", "role-adult": "A21_PLUS" },
  });
}

const bands = (id: string): MemberBand =>
  id === "user-kid" ? { band: "A9_12", provenance: "server_role" } : { band: "A21_PLUS", provenance: "server_role" };

function message(over: Partial<DiscordMessageLike> = {}): DiscordMessageLike {
  return {
    id: "m1",
    guildId: GUILD,
    channelId: "chan-general",
    channelType: "guild_text",
    authorId: "user-adult",
    authorBot: false,
    authorRoleIds: ["role-adult"],
    authorCreatedAt: new Date("2020-01-01T00:00:00Z"),
    content: "hello there",
    createdAt: new Date("2026-09-02T12:00:00Z"),
    mentionedUserIds: ["user-kid"],
    referencedAuthorId: null,
    attachmentCount: 0,
    displayNames: { "user-adult": "ryan_xx99", "user-kid": "kai_b" },
    ...over,
  };
}

/** Records name writes. Every other persistence call is a quiet no-op. */
function recorder() {
  const names: Array<{ hashedUid: string; name: string; retention: string }> = [];
  const quiet: ProxyHandler<object> = {
    get: (_target, prop) => {
      if (prop === "then") return undefined;
      return new Proxy(async () => null, quiet);
    },
    apply: async () => null,
  };
  const db = new Proxy(
    {
      accountName: {
        findUnique: async () => null,
        upsert: async (args: { create: { hashedUid: string; name: string; retention: string } }) => {
          names.push({ hashedUid: args.create.hashedUid, name: args.create.name, retention: args.create.retention });
          return null;
        },
      },
    },
    {
      get: (target, prop) =>
        prop in target ? (target as Record<string | symbol, unknown>)[prop] : new Proxy(async () => null, quiet),
    },
  );
  const persistence = { db, store: { recordTier: async () => undefined } } as unknown as Persistence;
  return { names, persistence };
}

function pipeline(salt: string, persistence: Persistence) {
  return new BotPipeline({
    kernel: new Kernel({ store: new MemoryKernelStore() }),
    audit: new AuditLog(new MemoryAuditStore(), "test-secret"),
    customerId: "cus_discord",
    idSalt: salt,
    persistence,
  });
}

const ladder = [
  "hey nice build",
  "i can send you some robux if you want",
  "are your parents home right now? do they check your phone?",
  "add me on 👻 my snap is ryan_xx99",
];

describe("account names", () => {
  it("keeps both names once the conversation is flagged, keyed by the salted hash", async () => {
    const salt = newCustomerSalt();
    const { names, persistence } = recorder();
    const p = pipeline(salt, persistence);
    let tier = "T0";
    for (const [i, content] of ladder.entries()) {
      const result = await p.handle(
        message({ id: `m${i}`, content, createdAt: new Date(Date.parse("2026-09-02T12:00:00Z") + i * 120_000) }),
        config(),
        bands,
      );
      tier = result.tier;
    }
    expect(tier).toBe("T2");
    const stored = new Map(names.map((n) => [n.hashedUid, n.name]));
    expect(stored.get(hashUid("user-adult", salt))).toBe("ryan_xx99");
    expect(stored.get(hashUid("user-kid", salt))).toBe("kai_b");
    // Never the Discord id itself.
    expect(names.some((n) => n.hashedUid === "user-adult" || n.hashedUid === "user-kid")).toBe(false);
  });

  it("keeps no name for a conversation that scored nothing", async () => {
    const { names, persistence } = recorder();
    const p = pipeline(newCustomerSalt(), persistence);
    const result = await p.handle(message({ content: "gg that was a good match" }), config(), bands);
    expect(result.tier).toBe("T0");
    expect(names).toEqual([]);
  });

  /*
   * An account paired only because nobody else was in the channel is not named
   * in the message itself. The channel roster remembers the name it had when it
   * last spoke, so that account gets a name too.
   */
  it("names an account found by adjacency from when it last spoke", async () => {
    const salt = newCustomerSalt();
    const { names, persistence } = recorder();
    const p = pipeline(salt, persistence);
    const at = (i: number) => new Date(Date.parse("2026-09-02T12:00:00Z") + i * 60_000);
    // The younger account speaks first, with its name on its own message.
    await p.handle(
      message({
        id: "k0",
        authorId: "user-kid",
        authorRoleIds: ["role-kid"],
        content: "anyone want to play",
        mentionedUserIds: [],
        displayNames: { "user-kid": "kai_b" },
        createdAt: at(0),
      }),
      config(),
      bands,
    );
    for (const [i, content] of ladder.entries()) {
      await p.handle(
        message({
          id: `a${i}`,
          content,
          mentionedUserIds: [],
          displayNames: { "user-adult": "ryan_xx99" },
          createdAt: at(i + 1),
        }),
        config(),
        bands,
      );
    }
    const stored = new Map(names.map((n) => [n.hashedUid, n.name]));
    expect(stored.get(hashUid("user-kid", salt))).toBe("kai_b");
  });
});
