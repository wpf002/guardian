import { AuditLog, MemoryAuditStore } from "@guardian/audit";
import { Kernel, MemoryKernelStore } from "@guardian/scorer";
import { newCustomerSalt, type AgeBand } from "@guardian/schema";
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
  type TextChannel,
} from "discord.js";
import { timeoutReason } from "./actions.js";
import { MemoryGuildConfigStore, defaultGuildConfig } from "./config.js";
import type { DiscordMessageLike } from "./mapping.js";
import { BotPipeline } from "./pipeline.js";

/**
 * Gateway adapter. Everything decision-shaped lives in pipeline.ts and is
 * tested without a Discord connection; this file is the thin edge that turns a
 * discord.js Message into the shape the pipeline reads and applies the action
 * it returns.
 *
 * Intents are deliberately narrow. There is no DM partial, no presence intent,
 * and no attachment fetch. The bot reads guild messages in servers it was
 * installed into and nothing else (DESIGN.md 8).
 */

const configs = new MemoryGuildConfigStore();

export function toDiscordMessageLike(message: Message): DiscordMessageLike {
  return {
    id: message.id,
    guildId: message.guildId,
    channelId: message.channelId,
    channelType: channelTypeOf(message),
    authorId: message.author.id,
    authorBot: message.author.bot,
    authorRoleIds: message.member ? [...message.member.roles.cache.keys()] : [],
    authorCreatedAt: message.author.createdAt ?? null,
    content: message.content,
    createdAt: message.createdAt,
    mentionedUserIds: [...message.mentions.users.keys()],
    referencedAuthorId: message.reference?.messageId
      ? (message.mentions.repliedUser?.id ?? null)
      : null,
    // Count only. The bot never opens an attachment URL.
    attachmentCount: message.attachments.size,
  };
}

function channelTypeOf(message: Message): DiscordMessageLike["channelType"] {
  switch (message.channel.type) {
    case ChannelType.DM:
      return "dm";
    case ChannelType.GroupDM:
      return "group_dm";
    case ChannelType.GuildText:
    case ChannelType.GuildAnnouncement:
      return "guild_text";
    case ChannelType.GuildVoice:
      return "guild_voice_text";
    case ChannelType.PublicThread:
    case ChannelType.PrivateThread:
    case ChannelType.AnnouncementThread:
      return "guild_thread";
    default:
      return "other";
  }
}

export async function start(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_BOT_TOKEN is not set");

  const auditSecret = process.env.AUDIT_CHAIN_SECRET ?? "";
  const audit = new AuditLog(new MemoryAuditStore(), auditSecret);
  const kernel = new Kernel({ store: new MemoryKernelStore() });
  const pipeline = new BotPipeline({
    kernel,
    audit,
    customerId: process.env.GUARDIAN_CUSTOMER_ID ?? "cus_discord",
    idSalt: process.env.GUARDIAN_ID_SALT ?? newCustomerSalt(),
  });

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      // Message content requires Discord verification above 100 servers
      // (DESIGN.md 12). Plan for that around week 10.
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.on(Events.MessageCreate, async (message) => {
    if (!message.guildId) return;

    const config = (await configs.get(message.guildId)) ?? defaultGuildConfig(message.guildId);
    const bands = (userId: string): AgeBand => {
      const member = message.guild?.members.cache.get(userId);
      if (!member) return config.defaultBand;
      for (const roleId of member.roles.cache.keys()) {
        const band = config.roleBands[roleId];
        if (band) return band;
      }
      return config.defaultBand;
    };

    const result = await pipeline.handle(toDiscordMessageLike(message), config, bands);
    if (result.action.kind === "none" || !result.alert) return;

    const channel = await message.client.channels.fetch(result.action.channelId);
    if (channel && channel.isTextBased() && "send" in channel) {
      await (channel as TextChannel).send(result.alert);
    }

    if (result.action.kind === "alert_and_timeout" && message.member?.moderatable) {
      await message.member.timeout(result.action.minutes * 60_000, timeoutReason(result.tier));
    }
  });

  client.once(Events.ClientReady, (ready) => {
    console.log(`guardian discord bot ready as ${ready.user.tag}`);
  });

  await client.login(token);
}

if (process.argv[1]?.endsWith("bot.js") || process.argv[1]?.endsWith("bot.ts")) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
