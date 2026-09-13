import { describe, expect, it } from "vitest";
import { directoryOf, syncDirectory, type GuildLike, type HandlerDeps } from "../src/bot.js";
import { MemoryGuildConfigStore } from "../src/config.js";

/*
 * The server's channels and roles by name, so the console offers a list to
 * pick from. Setting up used to mean pasting 18-digit ids copied with Developer
 * Mode on.
 */

function text(id: string, name: string, position: number) {
  return { id, name, position, isTextBased: () => true, isThread: () => false };
}

function guild(over: Partial<GuildLike> = {}): GuildLike {
  return {
    id: "g1",
    name: "Northwood Gaming",
    channels: {
      cache: new Map<string, ReturnType<typeof text> | Record<string, unknown>>([
        ["c2", text("c2", "mod-alerts", 2)],
        ["c1", text("c1", "general", 1)],
        ["cat", { id: "cat", name: "Text Channels", position: 0, isTextBased: () => false, isThread: () => false }],
        ["t1", { id: "t1", name: "a thread", position: 3, isTextBased: () => true, isThread: () => true }],
      ]) as never,
    },
    roles: {
      cache: new Map([
        ["g1", { id: "g1", name: "@everyone", position: 0 }],
        ["r1", { id: "r1", name: "Teens", position: 1 }],
        ["r2", { id: "r2", name: "Moderators", position: 5 }],
        ["bot", { id: "bot", name: "Guardian", position: 9, managed: true }],
      ]),
    },
    ...over,
  };
}

describe("directoryOf", () => {
  it("lists text channels in Discord's order, without categories or threads", () => {
    expect(directoryOf(guild()).channels).toEqual([
      { id: "c1", name: "general" },
      { id: "c2", name: "mod-alerts" },
    ]);
  });

  it("lists roles top first, without @everyone or a bot's own role", () => {
    expect(directoryOf(guild()).roles).toEqual([
      { id: "r2", name: "Moderators" },
      { id: "r1", name: "Teens" },
    ]);
  });

  it("returns empty lists for a guild with nothing cached", () => {
    expect(directoryOf({ id: "g", name: "x" })).toEqual({ channels: [], roles: [] });
  });
});

describe("syncDirectory", () => {
  function deps(configs: MemoryGuildConfigStore): HandlerDeps {
    return { configs } as unknown as HandlerDeps;
  }

  it("creates the settings row for a server that has none, with scoring off", async () => {
    const configs = new MemoryGuildConfigStore();
    await syncDirectory(guild(), deps(configs));
    const row = await configs.get("g1");
    expect(row?.guildName).toBe("Northwood Gaming");
    expect(row?.roles.map((r) => r.name)).toEqual(["Moderators", "Teens"]);
    expect(row?.enabled).toBe(false);
    expect(row?.modChannelId).toBeNull();
  });

  it("keeps the alerts channel's name in step with a rename", async () => {
    const configs = new MemoryGuildConfigStore();
    await syncDirectory(guild(), deps(configs));
    const row = (await configs.get("g1"))!;
    await configs.put({ ...row, modChannelId: "c2", modChannelName: "mod-alerts" });

    const renamed = guild({
      channels: { cache: new Map([["c2", text("c2", "safety-team", 2)]]) as never },
    });
    await syncDirectory(renamed, deps(configs));
    expect((await configs.get("g1"))?.modChannelName).toBe("safety-team");
  });

  it("writes nothing when nothing changed", async () => {
    const configs = new MemoryGuildConfigStore();
    await syncDirectory(guild(), deps(configs));
    let puts = 0;
    const counting = new Proxy(configs, {
      get(target, prop, receiver) {
        if (prop === "put") {
          return async (...args: Parameters<MemoryGuildConfigStore["put"]>) => {
            puts += 1;
            return target.put(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    await syncDirectory(guild(), deps(counting));
    expect(puts).toBe(0);
  });

  it("never turns scoring on or changes a setting the owner made", async () => {
    const configs = new MemoryGuildConfigStore();
    await syncDirectory(guild(), deps(configs));
    const row = (await configs.get("g1"))!;
    await configs.put({ ...row, enabled: true, modChannelId: "c2", roleBands: { r1: "A13_15" } });
    await syncDirectory(guild({ name: "Northwood Gaming (renamed)" }), deps(configs));
    const after = (await configs.get("g1"))!;
    expect(after.enabled).toBe(true);
    expect(after.roleBands).toEqual({ r1: "A13_15" });
    expect(after.guildName).toBe("Northwood Gaming (renamed)");
  });
});
