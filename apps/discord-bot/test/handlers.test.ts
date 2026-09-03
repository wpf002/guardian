import { AuditLog, MemoryAuditStore } from "@guardian/audit";
import { Kernel, MemoryKernelStore } from "@guardian/scorer";
import { newCustomerSalt } from "@guardian/schema";
import { Client, Events, GatewayIntentBits, type Message } from "discord.js";
import { describe, expect, it } from "vitest";
import { HandlerDeps, guarded, registerHandlers } from "../src/bot.js";
import { MemoryPairLookup } from "../src/commands.js";
import { MemoryGuildConfigStore, type GuildConfig, type GuildConfigStore } from "../src/config.js";
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

    // Enough of a Message for the listener to reach the config read.
    const message = { guildId: "guild-1" } as unknown as Message;
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
