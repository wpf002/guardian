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
  /**
   * Set when the message came through a webhook rather than from an account.
   *
   * A webhook is a relay. Game servers bridge their in-game chat into a Discord
   * channel through one, so those messages are real players talking, arriving
   * under one webhook id with a different display name each time. Refusing them
   * for being "bot" traffic makes Guardian blind to exactly the gaming chat it
   * exists to read.
   *
   * Guardian's own webhook is still refused: scoring the alerts it posts is a
   * loop, and that is what the bot check was really guarding against.
   */
  webhookId?: string | null;
  /** The relayed display name. One webhook carries many players. */
  authorName?: string | null;
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
  /**
   * For a thread, the channel it hangs off. Null anywhere else.
   *
   * Exclusion was an exact-id test on channelId, and a thread has its own id,
   * so an owner who excluded #support was still having every thread inside
   * #support read and scored. The exclusion list is a statement about where
   * Guardian may not look, and a thread is inside the place it names.
   */
  parentChannelId?: string | null;
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
 * How the target was arrived at. A reply is a statement by the sender about who
 * they are talking to; adjacency is Guardian's inference, and a case built on
 * one is a weaker claim than a case built on the other. The reviewer console
 * says which, because "they replied to the child" and "they were the only two
 * people in the channel" are different sentences to put in front of a person.
 */
export type TargetSource = "reply" | "mention" | "adjacency";

export interface TargetResult {
  uid: string | null;
  source: TargetSource | null;
}

/**
 * Who the message is addressed to.
 *
 * A reply wins over a mention. Failing both, the channel: if exactly one other
 * account has spoken there inside the adjacency window, this message is to
 * them.
 *
 * That third rule is why the bot sees anything at all. Without it a target came
 * only from a reply or a single @mention, and two people talking to each other
 * for twenty messages in a small server's #general produce neither, so the
 * kernel returned null for every one and nothing was scored, stored or paired.
 * The traffic this product exists to read was invisible to it.
 *
 * Exactly one, not the most recent of several. Three people in a channel are a
 * conversation and not a pair, and picking the likeliest partner out of them is
 * Guardian inventing a relationship and then scoring an age gap across it. In a
 * busy channel this correctly infers nothing.
 */
export const ADJACENCY_WINDOW_MS = 10 * 60 * 1000;

export function targetOf(
  msg: DiscordMessageLike,
  recentOtherAuthors: string[] = [],
): TargetResult {
  if (msg.referencedAuthorId && msg.referencedAuthorId !== msg.authorId) {
    return { uid: msg.referencedAuthorId, source: "reply" };
  }
  const mentioned = msg.mentionedUserIds.filter((id) => id !== msg.authorId);
  if (mentioned.length === 1) return { uid: mentioned[0]!, source: "mention" };
  if (mentioned.length > 1) return { uid: null, source: null };

  const self = relayActorUid(msg);
  const others = [...new Set(recentOtherAuthors.filter((id) => id !== self))];
  if (others.length === 1) return { uid: others[0]!, source: "adjacency" };
  return { uid: null, source: null };
}

export function accountAgeHours(createdAt: Date | null, now: Date): number | null {
  if (!createdAt) return null;
  return Math.max(0, (now.getTime() - createdAt.getTime()) / 3_600_000);
}

export type MapResult =
  | { ok: true; event: InboundEvent; targetSource: TargetSource | null }
  | { ok: false; refusal: MappingRefusal };

export function toEvent(
  msg: DiscordMessageLike,
  config: GuildConfig,
  memberBands: (userId: string) => MemberBand,
  now = new Date(),
  /** Other accounts that have spoken in this channel inside the window. */
  recentOtherAuthors: string[] = [],
): MapResult {
  // The bot has no business in a DM and Discord does not grant it one. This is
  // a refusal rather than a filter so it shows up in tests.
  if (msg.channelType === "dm" || msg.channelType === "group_dm") {
    return { ok: false, refusal: "dm_channel" };
  }
  if (!msg.guildId) return { ok: false, refusal: "no_guild" };
  // An application bot is refused. A webhook relay is not an application bot:
  // it is one account posting on behalf of people who said these things
  // somewhere else, which is what a game-chat bridge is.
  if (msg.authorBot && !msg.webhookId) return { ok: false, refusal: "bot_author" };
  // The thread's parent counts. Excluding a channel and still reading its
  // threads is reading the place the owner said not to look.
  if (
    config.excludedChannelIds.includes(msg.channelId) ||
    (msg.parentChannelId != null && config.excludedChannelIds.includes(msg.parentChannelId))
  ) {
    return { ok: false, refusal: "excluded_channel" };
  }
  if (!config.enabled || config.modChannelId === null) return { ok: false, refusal: "not_ready" };

  const target_ = targetOf(msg, recentOtherAuthors);
  const targetUid = target_.uid;
  const actor = bandWithProvenance(msg.authorRoleIds, config);
  const target = targetUid ? memberBands(targetUid) : null;

  return {
    ok: true,
    event: {
      externalId: msg.id,
      /*
       * One webhook relays many players, so the webhook's own id is the channel
       * rather than the speaker. The relayed display name is the identity, and
       * the webhook id scopes it so two servers bridging a player called "Sam"
       * are two different actors.
       */
      actorUid: relayActorUid(msg),
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
    targetSource: target_.source,
  };
}

/**
 * Who this message is from.
 *
 * An ordinary message is from its author. A webhook message is from whoever the
 * relay says it is, scoped by the webhook so two bridges carrying the same
 * display name stay apart. A relay with no name falls back to the webhook, which
 * treats the whole bridge as one speaker rather than inventing an identity.
 */
export function relayActorUid(msg: DiscordMessageLike): string {
  if (!msg.webhookId) return msg.authorId;
  const name = msg.authorName?.trim();
  return name ? `webhook:${msg.webhookId}:${name}` : `webhook:${msg.webhookId}`;
}
