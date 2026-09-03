import { AuditLog, MemoryAuditStore } from "@guardian/audit";
import { Kernel, MemoryKernelStore } from "@guardian/scorer";
import { hashUid, newCustomerSalt, type AgeBand } from "@guardian/schema";
import { createPrismaClient } from "@guardian/schema/db";
import {
  AttachmentBuilder,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Message,
  type TextChannel,
} from "discord.js";
import { timeoutReason } from "./actions.js";
import {
  COMMAND_NAME,
  handleCommand,
  MemoryPairLookup,
  type CommandRequest,
  type PairLookup,
} from "./commands.js";
import { MemoryGuildConfigStore, defaultGuildConfig, type GuildConfigStore } from "./config.js";
import type { DiscordMessageLike } from "./mapping.js";
import { BotPipeline } from "./pipeline.js";
import { PrismaGuildConfigStore, PrismaPairStats, type GuardianDb } from "./prisma-config.js";

/**
 * Gateway adapter. Everything decision-shaped lives in pipeline.ts and
 * commands.ts and is tested without a Discord connection; this file is the thin
 * edge that turns a discord.js Message into the shape the pipeline reads,
 * applies the action it returns, and turns a slash command interaction into a
 * CommandInput and its reply back into an ephemeral response.
 *
 * Intents are deliberately narrow. There is no DM partial, no presence intent,
 * and no attachment fetch. The bot reads guild messages in servers it was
 * installed into and nothing else (DESIGN.md 8).
 */

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

/**
 * Read the slash command options into the plain request the handler takes.
 * Returns null for a subcommand this build does not know, which can happen
 * when commands were registered from a newer commands.ts than the one running.
 */
export function requestFrom(interaction: ChatInputCommandInteraction): CommandRequest | null {
  const opts = interaction.options;
  switch (opts.getSubcommand(true)) {
    case "setup":
      return {
        name: "setup",
        channelId: opts.getChannel("channel", true).id,
        enable: opts.getBoolean("enable"),
      };
    case "role":
      return { name: "role", roleId: opts.getRole("role", true).id, band: opts.getString("band", true) };
    case "trusted":
      return { name: "trusted", roleId: opts.getRole("role", true).id };
    case "timeout":
      return {
        name: "timeout",
        mode: opts.getString("mode", true) === "on" ? "on" : "off",
        minutes: opts.getInteger("minutes"),
      };
    case "exclude":
      return { name: "exclude", channelId: opts.getChannel("channel", true).id };
    case "status":
      return { name: "status" };
    case "export":
      return {
        name: "export",
        senderId: opts.getUser("sender", true).id,
        recipientId: opts.getUser("recipient", true).id,
      };
    case "verify":
      return { name: "verify" };
    default:
      return null;
  }
}

export async function start(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_BOT_TOKEN is not set");

  const customerId = process.env.GUARDIAN_CUSTOMER_ID ?? "cus_discord";
  const idSalt = process.env.GUARDIAN_ID_SALT ?? newCustomerSalt();
  const auditSecret = process.env.AUDIT_CHAIN_SECRET ?? "";
  const audit = new AuditLog(new MemoryAuditStore(), auditSecret);
  const kernel = new Kernel({ store: new MemoryKernelStore() });
  const pipeline = new BotPipeline({ kernel, audit, customerId, idSalt });

  // Guild configuration lives in Postgres when there is one, so a restart does
  // not forget which channel the owner picked. Everything else stays in process
  // for phase 1 (docs/PHASE1.md, open items).
  const databaseUrl = process.env.DATABASE_URL;
  const db: GuardianDb | null = databaseUrl ? createPrismaClient(databaseUrl) : null;
  const configs: GuildConfigStore = db
    ? new PrismaGuildConfigStore(db.guildConfig, customerId)
    : new MemoryGuildConfigStore();
  if (db) console.log("guild configuration backed by postgres");

  const pairBook = new MemoryPairLookup();
  const pairStats = db ? new PrismaPairStats(db.pair, customerId) : null;
  const pairs: PairLookup = {
    history: (actorUid, targetUid) => pairBook.history(actorUid, targetUid),
    recentTierCounts: (since) =>
      pairStats ? pairStats.recentTierCounts(since) : pairBook.recentTierCounts(since),
  };

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
    if (result.scored) {
      const pair = result.scored.result.pair;
      pairBook.record(pair.actorUid, pair.targetUid, result.tier, result.scored.result.rationale, message.createdAt);
    }
    if (result.action.kind === "none" || !result.alert) return;

    const channel = await message.client.channels.fetch(result.action.channelId);
    if (channel && channel.isTextBased() && "send" in channel) {
      await (channel as TextChannel).send(result.alert);
    }

    if (result.action.kind === "alert_and_timeout" && message.member?.moderatable) {
      await message.member.timeout(result.action.minutes * 60_000, timeoutReason(result.tier));
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== COMMAND_NAME) return;

    // Every reply is ephemeral. Deferring first keeps the three second window
    // from expiring while status counts or an export run.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const request = requestFrom(interaction);
    if (!request) {
      await interaction.editReply({ content: "That subcommand is not available in this build. Re-run the register script." });
      return;
    }

    try {
      const reply = await handleCommand(
        {
          guildId: interaction.guildId,
          invokerId: interaction.user.id,
          canManageGuild: interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false,
          request,
        },
        { configs, pipeline, audit, pairs, hashUid: (id) => hashUid(id, idSalt) },
      );
      await interaction.editReply({
        content: reply.content,
        files: (reply.files ?? []).map(
          (file) => new AttachmentBuilder(Buffer.from(file.content, "utf8"), { name: file.name }),
        ),
      });
    } catch (err) {
      // Log the failure without the command's arguments: they name accounts.
      console.error(`guardian /${COMMAND_NAME} ${request.name} failed`, err instanceof Error ? err.message : err);
      await interaction.editReply({ content: "That command failed and nothing was changed. Check the bot's logs." });
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
