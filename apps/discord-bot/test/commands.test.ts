import { AuditLog, MemoryAuditStore } from "@guardian/audit";
import { buildEvidenceBundle } from "@guardian/scorer";
import { isAccusatory, type EvidenceBundle, type Tier } from "@guardian/schema";
import { describe, expect, it } from "vitest";
import {
  GUARDIAN_COMMAND,
  MemoryPairLookup,
  SUBCOMMANDS,
  handleCommand,
  isBundleable,
  type CommandDeps,
  type CommandInput,
  type CommandReply,
  type CommandRequest,
} from "../src/commands.js";
import { MemoryGuildConfigStore, defaultGuildConfig, guildConfigSchema } from "../src/config.js";

const GUILD = "guild-1";
const MOD_CHANNEL = "chan-mods";
const NOW = new Date("2026-09-03T12:00:00Z");

/** Every reply produced in this file, checked for accusatory language at the end. */
const replies: CommandReply[] = [];

interface Fixture {
  deps: CommandDeps;
  configs: MemoryGuildConfigStore;
  pairs: MemoryPairLookup;
  audit: AuditLog;
  auditStore: MemoryAuditStore;
  exports: Array<{ actorUid: string; targetUid: string; tier: Tier; guildId: string }>;
}

function fixture(): Fixture {
  const configs = new MemoryGuildConfigStore();
  const pairs = new MemoryPairLookup();
  const auditStore = new MemoryAuditStore();
  const audit = new AuditLog(auditStore, "test-secret");
  const exports: Fixture["exports"] = [];

  const pipeline = {
    async exportBundle(
      actorUid: string,
      targetUid: string,
      tier: Tier,
      guildId: string,
      rationale: string[],
    ): Promise<EvidenceBundle> {
      exports.push({ actorUid, targetUid, tier, guildId });
      const head = await audit.head();
      const bundle = buildEvidenceBundle({
        customerId: "cus_discord",
        actorUid,
        targetUid,
        tier,
        timeline: [
          {
            ts: NOW,
            channel: "chan-general",
            direction: "actor_to_target",
            text: "are your parents home right now?",
            mediaSha256: null,
            knownCsamVerdict: null,
            stage: "probe",
            signals: ["supervision_probe"],
          },
        ],
        signals: [],
        versions: { modelVersion: "rules-v1", lexiconVersion: "v1", fusionVersion: "rules-v1" },
        provenance: [{ surface: "discord", sourceId: guildId }],
        auditHead: head.hash,
        now: NOW,
      });
      await audit.append({
        kind: "bundle.exported",
        customerId: "cus_discord",
        payload: { bundleId: bundle.bundleId, rationale },
      });
      return bundle;
    },
  };

  return {
    deps: {
      configs,
      pipeline,
      audit,
      pairs,
      hashUid: (id) => `h_${id}`,
      now: () => NOW,
    },
    configs,
    pairs,
    audit,
    auditStore,
    exports,
  };
}

async function run(
  f: Fixture,
  request: CommandRequest,
  overrides: Partial<Omit<CommandInput, "request">> = {},
): Promise<CommandReply> {
  const reply = await handleCommand(
    { guildId: GUILD, invokerId: "owner", canManageGuild: true, request, ...overrides },
    f.deps,
  );
  replies.push(reply);
  return reply;
}

async function seedConfig(f: Fixture, overrides: Record<string, unknown> = {}) {
  await f.configs.put(
    guildConfigSchema.parse({ guildId: GUILD, modChannelId: MOD_CHANNEL, enabled: true, ...overrides }),
  );
}

describe("command tree", () => {
  it("registers every subcommand under /guardian and only in servers", () => {
    expect(GUARDIAN_COMMAND.name).toBe("guardian");
    const names = (GUARDIAN_COMMAND.options ?? []).map((o) => o.name);
    expect(names).toEqual([...SUBCOMMANDS]);
    expect(GUARDIAN_COMMAND.contexts).toEqual([0]);
  });

  it("offers all seven bands as choices on /guardian role", () => {
    const role = (GUARDIAN_COMMAND.options ?? []).find((o) => o.name === "role");
    const band = (role && "options" in role ? role.options : [])?.find((o) => o.name === "band");
    const choices = band && "choices" in band ? band.choices : undefined;
    expect(choices?.map((c) => c.value)).toContain("UNKNOWN");
    expect(choices).toHaveLength(7);
  });
});

describe("permissions", () => {
  it("refuses configuration from a member without Manage Server", async () => {
    const f = fixture();
    const reply = await run(f, { name: "role", roleId: "role-kid", band: "A9_12" }, { canManageGuild: false });
    expect(reply.content).toContain("Manage Server");
    expect(await f.configs.get(GUILD)).toBeNull();
  });

  it("refuses an export from a member without Manage Server", async () => {
    const f = fixture();
    f.pairs.record("h_adult", "h_kid", "T2", ["reason"], NOW);
    const reply = await run(
      f,
      { name: "export", senderId: "adult", recipientId: "kid" },
      { canManageGuild: false },
    );
    expect(reply.content).toContain("Manage Server");
    expect(f.exports).toHaveLength(0);
  });

  it("lets anyone read status", async () => {
    const f = fixture();
    const reply = await run(f, { name: "status" }, { canManageGuild: false });
    expect(reply.content).toContain("Scoring: off");
  });

  it("does nothing outside a server", async () => {
    const f = fixture();
    const reply = await run(f, { name: "status" }, { guildId: null });
    expect(reply.content).toContain("inside a server");
  });
});

describe("setup", () => {
  it("sets the mod channel and turns scoring on", async () => {
    const f = fixture();
    const reply = await run(f, { name: "setup", channelId: MOD_CHANNEL });
    const config = await f.configs.get(GUILD);
    expect(config?.modChannelId).toBe(MOD_CHANNEL);
    expect(config?.enabled).toBe(true);
    expect(reply.content).toContain(`<#${MOD_CHANNEL}>`);
    expect(reply.content).toContain("Scoring is on");
  });

  it("can set the channel with scoring left off", async () => {
    const f = fixture();
    await run(f, { name: "setup", channelId: MOD_CHANNEL, enable: false });
    expect((await f.configs.get(GUILD))?.enabled).toBe(false);
  });
});

describe("role mapping", () => {
  it("rejects a band that is not one of the six plus UNKNOWN", async () => {
    const f = fixture();
    await seedConfig(f);
    const reply = await run(f, { name: "role", roleId: "role-kid", band: "A99_PLUS" });
    expect(reply.content).toContain("not an age band");
    expect((await f.configs.get(GUILD))?.roleBands).toEqual({});
  });

  it("maps a role to a band, and to UNKNOWN", async () => {
    const f = fixture();
    await run(f, { name: "role", roleId: "role-kid", band: "A9_12" });
    await run(f, { name: "role", roleId: "role-guest", band: "UNKNOWN" });
    expect((await f.configs.get(GUILD))?.roleBands).toEqual({ "role-kid": "A9_12", "role-guest": "UNKNOWN" });
  });

  it("never mentions a birthdate", async () => {
    const f = fixture();
    const reply = await run(f, { name: "role", roleId: "role-kid", band: "A9_12" });
    expect(reply.content).toContain("never a birthdate");
  });
});

describe("trusted roles", () => {
  it("adds on the first call and removes on the second", async () => {
    const f = fixture();
    await run(f, { name: "trusted", roleId: "role-mod" });
    expect((await f.configs.get(GUILD))?.trustedRoleIds).toEqual(["role-mod"]);
    const reply = await run(f, { name: "trusted", roleId: "role-mod" });
    expect((await f.configs.get(GUILD))?.trustedRoleIds).toEqual([]);
    expect(reply.content).toContain("no longer");
  });
});

describe("timeout", () => {
  it("rejects minutes outside 1 to 10080 and non-integers, leaving config untouched", async () => {
    const f = fixture();
    for (const minutes of [0, 10_081, 1.5, -5]) {
      const reply = await run(f, { name: "timeout", mode: "on", minutes });
      expect(reply.content).toContain("Nothing was changed");
    }
    expect(await f.configs.get(GUILD)).toBeNull();
  });

  it("turns on with a valid length and off again", async () => {
    const f = fixture();
    await run(f, { name: "timeout", mode: "on", minutes: 30 });
    let config = await f.configs.get(GUILD);
    expect(config?.autoTimeoutOnT2).toBe(true);
    expect(config?.autoTimeoutMinutes).toBe(30);

    await run(f, { name: "timeout", mode: "off" });
    config = await f.configs.get(GUILD);
    expect(config?.autoTimeoutOnT2).toBe(false);
    expect(config?.autoTimeoutMinutes).toBe(30);
  });

  it("keeps the previous length when minutes is omitted", async () => {
    const f = fixture();
    await seedConfig(f, { autoTimeoutMinutes: 15 });
    await run(f, { name: "timeout", mode: "on" });
    expect((await f.configs.get(GUILD))?.autoTimeoutMinutes).toBe(15);
  });

  it("describes the timeout as friction, not a verdict", async () => {
    const f = fixture();
    const reply = await run(f, { name: "timeout", mode: "on", minutes: 10 });
    expect(reply.content).toContain("not a verdict");
  });
});

describe("exclude", () => {
  it("toggles a channel", async () => {
    const f = fixture();
    await run(f, { name: "exclude", channelId: "chan-adults" });
    expect((await f.configs.get(GUILD))?.excludedChannelIds).toEqual(["chan-adults"]);
    await run(f, { name: "exclude", channelId: "chan-adults" });
    expect((await f.configs.get(GUILD))?.excludedChannelIds).toEqual([]);
  });
});

describe("status", () => {
  it("shows the config, scoring state, weekly tier counts and the audit head", async () => {
    const f = fixture();
    await seedConfig(f, {
      roleBands: { "role-kid": "A9_12" },
      trustedRoleIds: ["role-mod"],
      excludedChannelIds: ["chan-adults"],
    });
    f.pairs.record("a", "b", "T1", [], NOW);
    f.pairs.record("c", "d", "T2", ["reason"], NOW);
    f.pairs.record("e", "f", "T2", ["reason"], new Date("2026-08-01T00:00:00Z"));
    await f.audit.append({ kind: "score.assigned", customerId: "cus_discord", payload: {} });

    const reply = await run(f, { name: "status" });
    expect(reply.content).toContain("Scoring: on");
    expect(reply.content).toContain(`<#${MOD_CHANNEL}>`);
    expect(reply.content).toContain("<@&role-kid>: 9 to 12");
    expect(reply.content).toContain("<@&role-mod>");
    expect(reply.content).toContain("<#chan-adults>");
    expect(reply.content).toContain("1 pairs at T1");
    expect(reply.content).toContain("1 pairs at T2");
    expect(reply.content).toContain("Audit chain: 1 entries");
    expect(reply.content).toContain("not findings about any person");
  });

  it("reports scoring off with an unconfigured guild", async () => {
    const f = fixture();
    const reply = await run(f, { name: "status" });
    expect(reply.content).toContain("Scoring: off");
    expect(reply.content).toContain("Mod channel: not set");
    expect(defaultGuildConfig(GUILD).enabled).toBe(false);
  });
});

describe("export", () => {
  it("refuses when the pair has no bundleable history and records no export", async () => {
    const f = fixture();
    const reply = await run(f, { name: "export", senderId: "adult", recipientId: "kid" });
    expect(reply.content).toContain("nothing to bundle");
    expect(reply.files).toBeUndefined();
    expect(f.exports).toHaveLength(0);
    expect(f.auditStore.size()).toBe(0);
  });

  it("refuses a pair that never rose above T0", async () => {
    const f = fixture();
    f.pairs.record("h_adult", "h_kid", "T0", [], NOW);
    const reply = await run(f, { name: "export", senderId: "adult", recipientId: "kid" });
    expect(reply.content).toContain("tier T0");
    expect(f.exports).toHaveLength(0);
  });

  it("refuses the same account twice", async () => {
    const f = fixture();
    const reply = await run(f, { name: "export", senderId: "adult", recipientId: "adult" });
    expect(reply.content).toContain("two different accounts");
    expect(f.exports).toHaveLength(0);
  });

  it("attaches the report draft as a file on an ephemeral reply", async () => {
    const f = fixture();
    f.pairs.record("h_adult", "h_kid", "T2", ["Supervision probing followed by a migration ask."], NOW);
    const reply = await run(f, { name: "export", senderId: "adult", recipientId: "kid" });

    expect(reply.ephemeral).toBe(true);
    expect(f.exports).toEqual([{ actorUid: "h_adult", targetUid: "h_kid", tier: "T2", guildId: GUILD }]);
    expect(reply.content).toContain("You are the reporter");
    expect(reply.content).toContain("report.cybertip.org");
    expect(reply.files).toHaveLength(1);
    const file = reply.files![0]!;
    expect(file.name).toMatch(/^guardian-report-draft-bdl_.*\.txt$/);
    expect(file.content).toContain("CyberTipline report draft");
    expect(file.content).toContain("You are the reporter");
    expect(file.content).toContain("Supervision probing");
    // Discord ids never appear in the draft; the bundle carries hashed uids only.
    expect(file.content).not.toContain("adult");
    expect(file.content).not.toContain("kid");
  });

  it("keeps the highest tier a pair reached", () => {
    const pairs = new MemoryPairLookup();
    pairs.record("a", "b", "T2", ["reason"], NOW);
    pairs.record("a", "b", "T1", [], NOW);
    return pairs.history("a", "b").then((h) => {
      expect(h?.tier).toBe("T2");
      expect(h?.messages).toBe(2);
      expect(isBundleable(h)).toBe(true);
    });
  });
});

describe("verify", () => {
  it("reports an intact chain", async () => {
    const f = fixture();
    await f.audit.append({ kind: "score.assigned", customerId: "cus_discord", payload: { tier: "T1" } });
    await f.audit.append({ kind: "score.assigned", customerId: "cus_discord", payload: { tier: "T2" } });
    const reply = await run(f, { name: "verify" });
    expect(reply.content).toContain("Audit chain intact");
    expect(reply.content).toContain("2 entries checked");
  });

  it("names the broken row after tampering", async () => {
    const f = fixture();
    await f.audit.append({ kind: "score.assigned", customerId: "cus_discord", payload: { tier: "T1" } });
    await f.audit.append({ kind: "score.assigned", customerId: "cus_discord", payload: { tier: "T2" } });
    f.auditStore.tamper(1, (entry) => {
      entry.payload = { tier: "T0" };
    });
    const reply = await run(f, { name: "verify" });
    expect(reply.content).toContain("broken at entry 1");
    expect(reply.content).toContain("hash_mismatch");
  });
});

describe("every reply", () => {
  it("is ephemeral and passes the accusation guard", () => {
    expect(replies.length).toBeGreaterThan(20);
    for (const reply of replies) {
      expect(reply.ephemeral).toBe(true);
      expect(isAccusatory(reply.content)).toBe(false);
      for (const file of reply.files ?? []) expect(isAccusatory(file.content)).toBe(false);
    }
  });
});
