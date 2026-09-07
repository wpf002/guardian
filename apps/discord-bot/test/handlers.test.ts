import { AuditLog, MemoryAuditStore } from "@guardian/audit";
import { Kernel, MemoryKernelStore } from "@guardian/scorer";
import { newCustomerSalt } from "@guardian/schema";
import { ChannelType, Client, Events, GatewayIntentBits, type ClientEvents } from "discord.js";
import { describe, expect, it } from "vitest";
import { HandlerDeps, guarded, handleMessage, registerHandlers } from "../src/bot.js";
import { MemoryPairLookup } from "../src/commands.js";
import {
  defaultGuildConfig,
  MemoryGuildConfigStore,
  type GuildConfig,
  type GuildConfigStore,
} from "../src/config.js";
import { BotPipeline } from "../src/pipeline.js";

/**
 * The gateway listeners must not be able to end the process. One process
 * serves every guild the bot is in, so an ordinary failure in one server (a
 * deleted mod channel, a lost Send Messages permission, a Postgres blip on the
 * config read) would otherwise stop scoring everywhere.
 */

function deps(overrides: Partial<HandlerDeps> = {}): {
  deps: HandlerDeps;
  failures: Array<{ where: string; error: unknown }>;
} {
  const failures: Array<{ where: string; error: unknown }> = [];
  const audit = new AuditLog(new MemoryAuditStore(), "test-secret");
  const pairBook = new MemoryPairLookup();
  return {
    failures,
    deps: {
      configs: new MemoryGuildConfigStore(),
      pipeline: new BotPipeline({
        kernel: new Kernel({ store: new MemoryKernelStore() }),
        audit,
        customerId: "cus_discord",
        idSalt: newCustomerSalt(),
      }),
      pairBook,
      pairs: pairBook,
      audit,
      hashUid: (id) => `h_${id}`,
      onError: (where, error) => failures.push({ where, error }),
      ...overrides,
    },
  };
}

/** A config store that fails the way a database outage does. */
const failingConfigs: GuildConfigStore = {
  async get(): Promise<GuildConfig | null> {
    throw Object.assign(new Error("connection refused"), { name: "PrismaClientInitializationError" });
  },
  async put(): Promise<void> {
    throw new Error("connection refused");
  },
};

function client(): Client {
  return new Client({ intents: [GatewayIntentBits.Guilds] });
}

describe("listener guards", () => {
  it("swallows and reports a failure inside the message listener", async () => {
    const f = deps({ configs: failingConfigs });
    const c = client();
    registerHandlers(c, f.deps);

    // Enough of a Message for the listener to reach the config read. Typed as
    // the event's own argument rather than as Message: discord.js narrows the
    // messageCreate payload, and a bare Message does not satisfy emit().
    const message = { guildId: "guild-1" } as unknown as ClientEvents[Events.MessageCreate][0];
    expect(() => c.emit(Events.MessageCreate, message)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(f.failures.map((entry) => entry.where)).toEqual(["messageCreate"]);
    c.destroy();
  });

  it("registers a client error listener, so a re-emitted rejection is not fatal", async () => {
    const f = deps();
    const c = client();
    registerHandlers(c, f.deps);

    // Without a listener on this event, EventEmitter rethrows and Node exits.
    expect(c.listenerCount(Events.Error)).toBeGreaterThan(0);
    expect(() => c.emit(Events.Error, new Error("10003 Unknown Channel"))).not.toThrow();
    expect(f.failures.map((entry) => entry.where)).toEqual(["client"]);
    c.destroy();
  });

  it("reports rather than rethrows whatever a guarded body throws", async () => {
    const f = deps();
    await expect(
      guarded(f.deps, "alert", async () => {
        throw Object.assign(new Error("Missing Permissions"), { name: "DiscordAPIError", code: 50013 });
      }),
    ).resolves.toBeUndefined();
    expect(f.failures[0]?.where).toBe("alert");
  });
});

/**
 * Where the alert may land. Two guards on the same send.
 *
 * FORBIDDEN_ACTIONS has listed "post in a public channel" since the first
 * commit and nothing read that list, while `/guardian setup` offered every
 * GUILD_TEXT channel, so #general was one click away. And Client#channels is a
 * client-wide manager that resolves any channel the bot can see in any guild,
 * while the mod channel id is free text in the console, so a paste from the
 * wrong tab posted one server's alert into another.
 *
 * The alert names two accounts, pings them, and describes a grooming
 * trajectory. Either failure puts that in front of people who should not have
 * it, including the accounts it is about.
 */
describe("where a mod alert may be sent", () => {
  const GUILD = "guild-1";

  /** A guild config with scoring on and a mod channel set. */
  async function configured(configs: MemoryGuildConfigStore) {
    // put() keys on config.guildId, so the guild id has to be in the object.
    await configs.put({
      ...defaultGuildConfig(GUILD),
      modChannelId: "mod-channel",
      enabled: true,
      roleBands: { "role-adult": "A21_PLUS", "role-kid": "A13_15" },
    });
  }

  function fakeChannel(opts: { guildId: string; everyoneCanView: boolean; sent: string[] }) {
    return {
      guildId: opts.guildId,
      guild: { roles: { everyone: { id: "everyone" } } },
      isTextBased: () => true,
      permissionsFor: () => ({ has: () => opts.everyoneCanView }),
      send: async (text: string) => {
        opts.sent.push(text);
      },
    };
  }

  /** Drive the documented ladder until the pair reaches a tier that alerts. */
  async function run(channelOpts: { guildId: string; everyoneCanView: boolean }) {
    const sent: string[] = [];
    const configs = new MemoryGuildConfigStore();
    await configured(configs);
    const f = deps({ configs });
    const channel = fakeChannel({ ...channelOpts, sent });

    const lines = [
      "hey nice build, whats your favourite game",
      "youre really mature for your age, i feel like i can tell you anything",
      "are your parents around right now, do they check your messages",
      "add me on snapchat so we can talk properly, dont tell anyone",
    ];
    for (const [i, content] of lines.entries()) {
      const message = {
        id: `m${i}`,
        guildId: GUILD,
        channelId: "general",
        content,
        author: { id: "adult", bot: false, createdAt: new Date("2020-01-01T00:00:00Z") },
        member: { roles: { cache: new Map([["role-adult", {}]]) }, moderatable: false },
        // The target's band is read off the guild member cache, which is what
        // makes this an adult-to-minor pair rather than two unknown bands.
        guild: {
          members: {
            cache: new Map([["kid", { roles: { cache: new Map([["role-kid", {}]]) } }]]),
          },
        },
        mentions: { users: new Map([["kid", {}]]), repliedUser: null },
        attachments: new Map(),
        createdAt: new Date(1_800_000_000_000 + i * 600_000),
        channel: { type: ChannelType.GuildText, isThread: () => false, parentId: null },
        client: { channels: { fetch: async () => channel } },
      } as unknown as ClientEvents[Events.MessageCreate][0];
      await handleMessage(message, f.deps);
    }
    return { sent, failures: f.failures };
  }

  it("refuses a channel in another guild and reports it, rather than sending", async () => {
    const { sent, failures } = await run({ guildId: "guild-other", everyoneCanView: false });
    expect(sent).toEqual([]);
    expect(failures.map((x) => x.where)).toContain("alert");
    expect(String(failures.find((x) => x.where === "alert")?.error)).toMatch(/not in this guild/);
  });

  it("refuses a channel everyone in the server can read", async () => {
    const { sent, failures } = await run({ guildId: GUILD, everyoneCanView: true });
    expect(sent).toEqual([]);
    expect(String(failures.find((x) => x.where === "alert")?.error)).toMatch(/readable by everyone/);
  });

  it("sends to a channel in this guild that everyone cannot read", async () => {
    const { sent, failures } = await run({ guildId: GUILD, everyoneCanView: false });
    expect(failures).toEqual([]);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0]).toContain("Needs a human look");
  });
});
