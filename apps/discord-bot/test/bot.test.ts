import { AuditLog, MemoryAuditStore } from "@guardian/audit";
import { Kernel, MemoryKernelStore } from "@guardian/scorer";
import { newCustomerSalt } from "@guardian/schema";
import { describe, expect, it } from "vitest";
import { decideAction, FORBIDDEN_ACTIONS } from "../src/actions.js";
import { buildModAlert, buildReportDraft } from "../src/alerts.js";
import { defaultGuildConfig, guildConfigSchema, isReady } from "../src/config.js";
import {
  bandForRoles,
  bandWithProvenance,
  targetOf,
  toEvent,
  visibilityFor,
  type DiscordMessageLike,
  type MemberBand,
} from "../src/mapping.js";
import { BotPipeline } from "../src/pipeline.js";

const GUILD = "guild-1";
const MOD_CHANNEL = "chan-mods";

function config(overrides: Record<string, unknown> = {}) {
  return guildConfigSchema.parse({
    guildId: GUILD,
    modChannelId: MOD_CHANNEL,
    enabled: true,
    roleBands: { "role-kid": "A9_12", "role-teen": "A13_15", "role-adult": "A21_PLUS" },
    trustedRoleIds: ["role-mod"],
    ...overrides,
  });
}

function message(overrides: Partial<DiscordMessageLike> = {}): DiscordMessageLike {
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
    ...overrides,
  };
}

/**
 * The resolver reports the band and the claim behind it. Both of these come
 * from a mapped guild role, which is what a real member with a mapped role
 * gives (F7).
 */
const bands = (id: string): MemberBand =>
  id === "user-kid"
    ? { band: "A9_12", provenance: "server_role" }
    : { band: "A21_PLUS", provenance: "server_role" };

describe("guild config", () => {
  it("does not score until an owner picks a mod channel and enables it", () => {
    expect(isReady(defaultGuildConfig(GUILD))).toBe(false);
    expect(isReady(config())).toBe(true);
    expect(isReady(config({ modChannelId: null }))).toBe(false);
  });

  it("defaults to Discord's teen-by-default status rather than unknown", () => {
    expect(defaultGuildConfig(GUILD).defaultBand).toBe("A13_15");
  });

  it("keeps auto timeout off until the owner opts in", () => {
    expect(defaultGuildConfig(GUILD).autoTimeoutOnT2).toBe(false);
  });
});

describe("mapping", () => {
  it("refuses a direct message outright", () => {
    const result = toEvent(message({ channelType: "dm" }), config(), bands);
    expect(result).toEqual({ ok: false, refusal: "dm_channel" });
  });

  it("refuses a group dm", () => {
    expect(toEvent(message({ channelType: "group_dm" }), config(), bands)).toEqual({
      ok: false,
      refusal: "dm_channel",
    });
  });

  it("refuses a channel the owner excluded", () => {
    const cfg = config({ excludedChannelIds: ["chan-general"] });
    expect(toEvent(message(), cfg, bands)).toEqual({ ok: false, refusal: "excluded_channel" });
  });

  it("ignores other bots", () => {
    expect(toEvent(message({ authorBot: true }), config(), bands)).toEqual({
      ok: false,
      refusal: "bot_author",
    });
  });

  it("maps roles to age bands", () => {
    expect(bandForRoles(["role-kid"], config())).toBe("A9_12");
    expect(bandForRoles(["role-nothing"], config())).toBe("A13_15");
  });

  it("says where a band came from, because a guild role is not a verified age", () => {
    expect(bandWithProvenance(["role-kid"], config())).toEqual({
      band: "A9_12",
      provenance: "server_role",
    });
    expect(bandWithProvenance(["role-nothing"], config())).toEqual({
      band: "A13_15",
      provenance: "platform_default",
    });
  });

  it("marks guild traffic as public and never claims that for a DM", () => {
    const result = toEvent(message(), config(), bands);
    expect(result.ok && result.event.channelVisibility).toBe("public");
    expect(result.ok && result.event.actorBandProvenance).toBe("server_role");
    expect(visibilityFor("dm")).toBe("private");
    expect(visibilityFor("group_dm")).toBe("group");
  });

  // F7. The target's provenance used to be inferred by comparing the resolved
  // band to the guild default, so an owner who maps a role to the same band as
  // the default recorded platform_default for every member holding that role.
  it("records the target's provenance as the resolver reported it", () => {
    const cfg = config({ defaultBand: "A9_12", roleBands: { "role-kid": "A9_12" } });
    const fromRole = toEvent(message(), cfg, () => ({
      band: "A9_12",
      provenance: "server_role",
    }));
    expect(fromRole.ok && fromRole.event.targetBand).toBe("A9_12");
    expect(fromRole.ok && fromRole.event.targetBandProvenance).toBe("server_role");

    const fromDefault = toEvent(message(), cfg, () => ({
      band: "A9_12",
      provenance: "platform_default",
    }));
    expect(fromDefault.ok && fromDefault.event.targetBandProvenance).toBe("platform_default");
  });

  it("never claims a source for a band the resolver could not resolve", () => {
    const unknown = toEvent(message(), config(), () => ({ band: "UNKNOWN", provenance: "unknown" }));
    expect(unknown.ok && unknown.event.targetBand).toBe("UNKNOWN");
    expect(unknown.ok && unknown.event.targetBandProvenance).toBe("unknown");

    const noTarget = toEvent(message({ mentionedUserIds: [] }), config(), bands);
    expect(noTarget.ok && noTarget.event.targetBandProvenance).toBe("unknown");
  });

  it("marks an owner vouched role as a trusted adult", () => {
    const result = toEvent(message({ authorRoleIds: ["role-mod", "role-adult"] }), config(), bands);
    expect(result.ok && result.event.actorRole).toBe("trusted_adult");
  });

  it("takes a reply as the target over a mention", () => {
    expect(targetOf(message({ referencedAuthorId: "user-other" }))).toBe("user-other");
  });

  it("has no single target when many accounts are mentioned", () => {
    expect(targetOf(message({ mentionedUserIds: ["a", "b", "c"] }))).toBeNull();
  });

  it("carries no attachment content, only the count", () => {
    const result = toEvent(message({ attachmentCount: 3 }), config(), bands);
    expect(result.ok && result.event.media).toBeNull();
    expect(JSON.stringify(result)).not.toContain("http");
  });

  it("passes the discord id through unhashed, because the edge hashes it", () => {
    const result = toEvent(message(), config(), bands);
    expect(result.ok && result.event.actorUid).toBe("user-adult");
  });
});

describe("actions", () => {
  it("does nothing on T0 and T1", () => {
    expect(decideAction("T0", config()).kind).toBe("none");
    expect(decideAction("T1", config()).kind).toBe("none");
  });

  it("alerts the mod channel on T2", () => {
    expect(decideAction("T2", config())).toEqual({
      kind: "alert_mod_channel",
      channelId: MOD_CHANNEL,
    });
  });

  it("adds a timeout only when the owner opted in", () => {
    const action = decideAction("T2", config({ autoTimeoutOnT2: true, autoTimeoutMinutes: 30 }));
    expect(action).toEqual({ kind: "alert_and_timeout", channelId: MOD_CHANNEL, minutes: 30 });
  });

  // FP-4 and F5. The S4 posture was computed, stored on the row, and read by
  // nobody, so a support-posture T2 still applied a Discord timeout to the
  // child the referral was written for.
  it("withholds the timeout under the support posture, even where the owner opted in", () => {
    const opted = config({ autoTimeoutOnT2: true, autoTimeoutMinutes: 30 });
    expect(decideAction("T2", opted, "enforcement")).toEqual({
      kind: "alert_and_timeout",
      channelId: MOD_CHANNEL,
      minutes: 30,
    });
    expect(decideAction("T2", opted, "support")).toEqual({
      kind: "alert_mod_channel",
      channelId: MOD_CHANNEL,
    });
    // A human still looks. What the posture removes is the enforcement action
    // taken against a child before they do.
    expect(decideAction("T3", opted, "support").kind).toBe("alert_mod_channel");
  });

  it("does nothing when no mod channel is set", () => {
    expect(decideAction("T2", config({ modChannelId: null })).kind).toBe("none");
  });

  it("documents what the bot must never do", () => {
    expect(FORBIDDEN_ACTIONS).toContain("dm the younger account");
    expect(FORBIDDEN_ACTIONS).toContain("contact law enforcement");
  });
});

describe("mod alert wording", () => {
  const alert = buildModAlert({
    tier: "T2",
    actorId: "user-adult",
    targetId: "user-kid",
    channelId: "chan-general",
    rationale: ["Supervision probing followed by a migration ask within 4 minutes."],
    criticalSignals: [],
    stagesHit: ["probe", "migrate"],
  });

  it("names the tier and the conversation, not a kind of person", () => {
    expect(alert).toContain("tier T2");
    expect(alert).toContain("<@user-adult>");
    expect(alert).toContain("not a finding about any person");
  });

  it("tells the moderator not to confront either account", () => {
    expect(alert).toContain("Do not message either account");
  });

  it("points at the CyberTipline and nowhere else", () => {
    expect(alert).toContain("report.cybertip.org");
    expect(alert.toLowerCase()).not.toContain("police");
  });
});

describe("pipeline", () => {
  function pipeline() {
    return new BotPipeline({
      kernel: new Kernel({ store: new MemoryKernelStore() }),
      audit: new AuditLog(new MemoryAuditStore(), "test-secret"),
      customerId: "cus_discord",
      idSalt: newCustomerSalt(),
    });
  }

  const ladder = [
    "hey nice build",
    "i can send you some robux if you want",
    "are your parents home right now? do they check your phone?",
    "add me on 👻 my snap is ryan_xx99",
  ];

  it("reaches T2 on the documented ladder and drafts an alert", async () => {
    const p = pipeline();
    let last = null;
    for (const [i, content] of ladder.entries()) {
      last = await p.handle(
        message({ id: `m${i}`, content, createdAt: new Date(Date.parse("2026-09-02T12:00:00Z") + i * 120_000) }),
        config(),
        bands,
      );
    }
    expect(last?.tier).toBe("T2");
    expect(last?.alert).toContain("tier T2");
  });

  // FP-4 and F5, end to end. Both accounts in a minor band, the owner opted
  // into the timeout, and the tier is forced by a critical signal.
  it("routes a minor-band account to the referral rather than to a timeout", async () => {
    const p = pipeline();
    const minorBands = (): MemberBand => ({ band: "A13_15", provenance: "server_role" });
    const result = await p.handle(
      message({
        content: "send it or i will ruin your life, you have 1 hour",
        authorRoleIds: ["role-teen"],
      }),
      config({ autoTimeoutOnT2: true, autoTimeoutMinutes: 60 }),
      minorBands,
    );

    expect(result.tier).toBe("T2");
    expect(result.scored?.result.suggestedPosture).toBe("support");
    expect(result.action.kind).toBe("alert_mod_channel");
    expect(result.alert).toContain("Take It Down");
    expect(result.alert).toContain("StopNCII");
  });

  it("keeps the enforcement card free of the referral", async () => {
    const p = pipeline();
    const result = await p.handle(
      message({ content: "send it or i will ruin your life, you have 1 hour" }),
      config({ autoTimeoutOnT2: true, autoTimeoutMinutes: 60 }),
      bands,
    );
    expect(result.scored?.result.suggestedPosture).toBe("enforcement");
    expect(result.action.kind).toBe("alert_and_timeout");
    expect(result.alert).not.toContain("Take It Down");
  });

  it("hashes the discord id before it reaches kernel state", async () => {
    const p = pipeline();
    const result = await p.handle(message({ content: ladder[2]! }), config(), bands);
    expect(result.scored?.result.pair.actorUid).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result.scored)).not.toContain("user-adult");
  });

  it("builds a report draft the owner files themselves", async () => {
    const p = pipeline();
    let last = null;
    for (const [i, content] of ladder.entries()) {
      last = await p.handle(
        message({ id: `m${i}`, content, createdAt: new Date(Date.parse("2026-09-02T12:00:00Z") + i * 120_000) }),
        config(),
        bands,
      );
    }
    const bundle = await p.exportBundle(
      GUILD,
      last!.scored!.result.pair.actorUid,
      last!.scored!.result.pair.targetUid,
      "T2",
      last!.scored!.result.rationale,
    );
    if (!bundle) throw new Error("expected a bundle for the guild the ladder was scored in");
    const draft = buildReportDraft(bundle, last!.scored!.result.rationale);

    expect(draft).toContain("You are the reporter");
    expect(draft).toContain("report.cybertip.org");
    expect(draft).toContain("Guardian holds no images or video");
    expect(draft).toContain(bundle.auditHead);
    expect(bundle.timeline.length).toBeGreaterThan(0);
  });

  it("cannot export a pair's messages from a server they were not scored in", async () => {
    const p = pipeline();
    let last = null;
    for (const [i, content] of ladder.entries()) {
      last = await p.handle(
        message({ id: `m${i}`, content, createdAt: new Date(Date.parse("2026-09-02T12:00:00Z") + i * 120_000) }),
        config(),
        bands,
      );
    }
    const actorUid = last!.scored!.result.pair.actorUid;
    const targetUid = last!.scored!.result.pair.targetUid;

    // One process serves every guild under one salt, so the pair key is the
    // same in a server the attacker owns. The timeline must not be reachable
    // from there (CLAUDE.md rule 8).
    const elsewhere = await p.exportBundle("guild-attacker", actorUid, targetUid, "T2", []);
    expect(elsewhere).toBeNull();

    const own = await p.exportBundle(GUILD, actorUid, targetUid, "T2", []);
    expect(own?.timeline.length).toBeGreaterThan(0);
  });

  it("keeps no raw text for a pair that never left T0", async () => {
    const p = pipeline();
    await p.handle(message({ content: "gg good game" }), config(), bands);
    const bundle = await p.exportBundle(
      GUILD,
      // Rebuild the same hash the pipeline used by scoring one more message.
      (await p.handle(message({ id: "m2", content: "nice" }), config(), bands)).scored!.result.pair.actorUid,
      (await p.handle(message({ id: "m3", content: "nice" }), config(), bands)).scored!.result.pair.targetUid,
      "T0",
      [],
    );
    for (const row of bundle!.timeline) expect(row.excerpt).toBeNull();
  });
});
