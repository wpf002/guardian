import type { AgeBand, InboundEvent } from "@guardian/schema";
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
  for (const roleId of roleIds) {
    const band = config.roleBands[roleId];
    if (band) return band;
  }
  return config.defaultBand;
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
  memberBands: (userId: string) => AgeBand,
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
      actorBand: bandForRoles(msg.authorRoleIds, config),
      targetBand: targetUid ? memberBands(targetUid) : "UNKNOWN",
      actorRole: roleFor(msg.authorRoleIds, config),
      actorAccountAgeHours: accountAgeHours(msg.authorCreatedAt, now),
      deviceHints: null,
      provenance: { surface: "discord", sourceId: msg.guildId },
    },
  };
}
