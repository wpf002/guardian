import { describe, expect, it } from "vitest";
import { defaultGuildConfig } from "../src/config.js";
import {
  PrismaGuildConfigStore,
  type GuildConfigDelegate,
  type GuildConfigRow,
  type GuildConfigWrite,
} from "../src/prisma-config.js";

/**
 * The guild_configs row belongs to one customer. Two deployments can share a
 * database and both sit in the same guild; neither may take the other's row.
 */

/** In-memory stand-in for the delegate, keyed the way the table now is. */
function fakeDelegate(): GuildConfigDelegate & { rows: Map<string, GuildConfigRow> } {
  const rows = new Map<string, GuildConfigRow>();
  const key = (guildId: string, customerId: string): string => `${guildId}|${customerId}`;
  return {
    rows,
    async findUnique(args) {
      const { guildId, customerId } = args.where.guildId_customerId;
      return rows.get(key(guildId, customerId)) ?? null;
    },
    async upsert(args) {
      const { guildId, customerId } = args.where.guildId_customerId;
      const existing = rows.get(key(guildId, customerId));
      const write: GuildConfigWrite = existing ? args.update : args.create;
      rows.set(key(guildId, customerId), {
        guildId,
        customerId: write.customerId,
        modChannelId: write.modChannelId,
        roleBands: write.roleBands,
        trustedRoleIds: write.trustedRoleIds,
        defaultBand: write.defaultBand,
        autoTimeoutOnT2: write.autoTimeoutOnT2,
        autoTimeoutMinutes: write.autoTimeoutMinutes,
        excludedChannelIds: write.excludedChannelIds,
        enabled: write.enabled,
      });
      return undefined;
    },
  };
}

describe("PrismaGuildConfigStore", () => {
  it("keeps a second customer's write off the first customer's row", async () => {
    const delegate = fakeDelegate();
    const a = new PrismaGuildConfigStore(delegate, "cus_a");
    const b = new PrismaGuildConfigStore(delegate, "cus_b");
    const guildId = "guild-1";

    await a.put({ ...defaultGuildConfig(guildId), modChannelId: "chan-a", enabled: true });
    expect(await b.get(guildId)).toBeNull();

    await b.put({ ...defaultGuildConfig(guildId), modChannelId: "chan-b", enabled: true });

    // Two rows, and the first customer still reads its own settings.
    expect(delegate.rows.size).toBe(2);
    expect((await a.get(guildId))?.modChannelId).toBe("chan-a");
    expect((await b.get(guildId))?.modChannelId).toBe("chan-b");
  });

  it("reads back what it wrote for its own customer", async () => {
    const delegate = fakeDelegate();
    const store = new PrismaGuildConfigStore(delegate, "cus_discord");
    const guildId = "guild-2";

    await store.put({
      ...defaultGuildConfig(guildId),
      modChannelId: "chan-mods",
      enabled: true,
      excludedChannelIds: ["chan-vent"],
    });
    const read = await store.get(guildId);
    expect(read?.excludedChannelIds).toEqual(["chan-vent"]);
    expect(read?.enabled).toBe(true);
  });
});
