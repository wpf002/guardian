import type { AgeBand, AgeBandProvenance, ChannelVisibility, InboundEvent } from "@guardian/schema";
import type { GuildConfig } from "./config.js";

/**
 * Discord message to canonical Event.
 *
 * Two hard rules live here. The bot reads only guild channels it was installed
 * into and never a DM: `channelType` other than a guild channel is refused
 * outright (DESIGN.md 8, "cannot read DMs, and that's fine: the DM request
 * happens in public channels first"). And uids leave this module unhashed
 * because the ingest edge does the per-customer hashing; nothing here writes
 * to storage.
 */

export interface DiscordMessageLike {
  id: string;
  guildId: string | null;
  channelId: string;
  channelType: "guild_text" | "guild_voice_text" | "guild_thread" | "dm" | "group_dm" | "other";
  authorId: string;
  authorBot: boolean;
  authorRoleIds: string[];
  /** Account creation time from the snowflake, for the new-account feature. */
  authorCreatedAt: Date | null;
  content: string;
  createdAt: Date;
  /** Who this message is aimed at: a reply target or a single mention. */
  mentionedUserIds: string[];
  referencedAuthorId: string | null;
  /** Attachment count only. The bot never reads attachment bytes or URLs. */
  attachmentCount: number;
}

export type MappingRefusal =
  | "dm_channel"
  | "no_guild"
  | "bot_author"
  | "excluded_channel"
  | "not_ready"
  | "no_target";

export function bandForRoles(roleIds: string[], config: GuildConfig): AgeBand {
  return bandWithProvenance(roleIds, config).band;
}

/**
 * A band together with the claim behind it. The resolver reports both, because
 * provenance cannot be inferred from the band: an owner who maps a role to the
 * same band as the guild default is the ordinary setup, and comparing the two
 * values reads every one of those members as an unmapped default.
 */
export interface MemberBand {
  band: AgeBand;
  provenance: AgeBandProvenance;
}

/**
 * The band and the claim behind it. A band the owner mapped to a guild role is
 * server_role; the fallback carries whatever the guild config says its default
 * is, which is platform_default unless the owner set something stronger.
 * Neither is a verified age, and the provenance is what says so on the row.
 */
export function bandWithProvenance(
  roleIds: string[],
  config: GuildConfig,
): { band: AgeBand; provenance: AgeBandProvenance } {
  for (const roleId of roleIds) {
    const band = config.roleBands[roleId];
    if (band) return { band, provenance: "server_role" };
  }
  return { band: config.defaultBand, provenance: config.defaultBandProvenance };
}

/**
 * Guild channels are open to the server, so they are public. The DM cases are
 * unreachable from toEvent, which refuses them before this is called, but they
 * are mapped rather than defaulted so that a future surface cannot inherit
 * "public" by accident. Regulation (EU) 2026/1881's stricter path applies to
 * anything not public, and treatAsPrivateMessaging is where that is decided.
 */
export function visibilityFor(
  channelType: DiscordMessageLike["channelType"],
): ChannelVisibility {
  switch (channelType) {
    case "dm":
      return "private";
    case "group_dm":
      return "group";
    default:
      return "public";
  }
}

export function roleFor(
  roleIds: string[],
  config: GuildConfig,
): InboundEvent["actorRole"] {
  return roleIds.some((r) => config.trustedRoleIds.includes(r)) ? "trusted_adult" : "member";
}

/**
 * Who the message is addressed to. A reply wins over a mention; a message with
 * many mentions has no single target and is scored for actor fan-out only.
 */
export function targetOf(msg: DiscordMessageLike): string | null {
  if (msg.referencedAuthorId && msg.referencedAuthorId !== msg.authorId) {
    return msg.referencedAuthorId;
  }
  const others = msg.mentionedUserIds.filter((id) => id !== msg.authorId);
  return others.length === 1 ? others[0]! : null;
}

export function accountAgeHours(createdAt: Date | null, now: Date): number | null {
  if (!createdAt) return null;
  return Math.max(0, (now.getTime() - createdAt.getTime()) / 3_600_000);
}

export type MapResult =
  | { ok: true; event: InboundEvent }
  | { ok: false; refusal: MappingRefusal };

export function toEvent(
  msg: DiscordMessageLike,
  config: GuildConfig,
  memberBands: (userId: string) => MemberBand,
  now = new Date(),
): MapResult {
  // The bot has no business in a DM and Discord does not grant it one. This is
  // a refusal rather than a filter so it shows up in tests.
  if (msg.channelType === "dm" || msg.channelType === "group_dm") {
    return { ok: false, refusal: "dm_channel" };
  }
  if (!msg.guildId) return { ok: false, refusal: "no_guild" };
  if (msg.authorBot) return { ok: false, refusal: "bot_author" };
  if (config.excludedChannelIds.includes(msg.channelId)) {
    return { ok: false, refusal: "excluded_channel" };
  }
  if (!config.enabled || config.modChannelId === null) return { ok: false, refusal: "not_ready" };

  const targetUid = targetOf(msg);
  const actor = bandWithProvenance(msg.authorRoleIds, config);
  const target = targetUid ? memberBands(targetUid) : null;

  return {
    ok: true,
    event: {
      externalId: msg.id,
      actorUid: msg.authorId,
      targetUid,
      channel: msg.channelId,
      ts: msg.createdAt,
      text: msg.content.length > 0 ? msg.content.slice(0, 8000) : null,
      // Attachments are counted, never fetched. A media event with no hash is
      // still a temporal marker for the payment join.
      media: null,
      actorBand: actor.band,
      targetBand: target?.band ?? "UNKNOWN",
      actorBandProvenance: actor.provenance,
      // Reported by the resolver, never inferred here. This column exists to
      // answer where an age claim came from, and the UK Online Safety Act's
      // highly-effective-age-assurance test turns on that answer, so a guess
      // is worse than no column. There is no calibrated confidence behind a
      // Discord role, so the confidence stays absent rather than becoming a
      // number nobody measured.
      targetBandProvenance: target?.provenance ?? "unknown",
      channelVisibility: visibilityFor(msg.channelType),
      actorRole: roleFor(msg.authorRoleIds, config),
      actorAccountAgeHours: accountAgeHours(msg.authorCreatedAt, now),
      deviceHints: null,
      provenance: { surface: "discord", sourceId: msg.guildId },
    },
  };
}
