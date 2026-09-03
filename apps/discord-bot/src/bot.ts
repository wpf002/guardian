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
import { PrismaGuildConfigStore, type GuardianDb } from "./prisma-config.js";

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

/**
 * Everything the two gateway listeners need. Passed in rather than closed over
 * so registerHandlers can be driven by a test without a Discord connection.
 */
export interface HandlerDeps {
  configs: GuildConfigStore;
  pipeline: BotPipeline;
  pairBook: MemoryPairLookup;
  pairs: PairLookup;
  audit: AuditLog;
  hashUid: (discordId: string) => string;
  /** Where a swallowed failure goes. Defaults to a console line with no arguments in it. */
  onError?: (where: string, err: unknown) => void;
}

/** Error class and driver code only. A message can quote a row or name an account. */
export function describeError(err: unknown): string {
  if (typeof err !== "object" || err === null) return typeof err;
  const name = (err as { name?: unknown }).name;
  const code = (err as { code?: unknown }).code;
  const base = typeof name === "string" && name.length > 0 ? name : "Error";
  return typeof code === "string" || typeof code === "number" ? `${base} ${code}` : base;
}

function report(deps: HandlerDeps, where: string, err: unknown): void {
  if (deps.onError) {
    deps.onError(where, err);
    return;
  }
  console.error(`guardian ${where} failed: ${describeError(err)}`);
}

/**
 * Run a listener body so that nothing it throws escapes.
 *
 * discord.js builds its Client with captureRejections, so a rejected listener
 * promise is re-emitted as an 'error' event on the Client, and with no error
 * listener Node turns that into an uncaught exception and the process exits.
 * One guild with a deleted mod channel or a missing Send Messages permission
 * would take scoring down for every other guild this process serves, so every
 * listener body runs inside this and an Events.Error listener is registered as
 * a backstop.
 */
export async function guarded(
  deps: HandlerDeps,
  where: string,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    report(deps, where, err);
  }
}

/** Score one message and apply whatever the pipeline decided. */
export async function handleMessage(message: Message, deps: HandlerDeps): Promise<void> {
  if (!message.guildId) return;
  const guildId = message.guildId;

  const config = (await deps.configs.get(guildId)) ?? defaultGuildConfig(guildId);
  const bands = (userId: string): AgeBand => {
    const member = message.guild?.members.cache.get(userId);
    if (!member) return config.defaultBand;
    for (const roleId of member.roles.cache.keys()) {
      const band = config.roleBands[roleId];
      if (band) return band;
    }
    return config.defaultBand;
  };

  const result = await deps.pipeline.handle(toDiscordMessageLike(message), config, bands);
  if (result.scored) {
    const pair = result.scored.result.pair;
    deps.pairBook.record(
      guildId,
      pair.actorUid,
      pair.targetUid,
      result.tier,
      result.scored.result.rationale,
      message.createdAt,
    );
  }
  const action = result.action;
  const alert = result.alert;
  if (action.kind === "none" || !alert) return;

  // Delivering the alert is its own guarded step. A mod channel that was
  // deleted, or one the bot may no longer post in, must not cost the timeout
  // or take the listener down.
  await guarded(deps, "alert", async () => {
    const channel = await message.client.channels.fetch(action.channelId);
    if (channel && channel.isTextBased() && "send" in channel) {
      await (channel as TextChannel).send(alert);
    }
  });

  if (action.kind === "alert_and_timeout" && message.member?.moderatable) {
    await guarded(deps, "timeout", async () => {
      await message.member?.timeout(action.minutes * 60_000, timeoutReason(result.tier));
    });
  }
}

/** Answer one /guardian interaction. Every reply is ephemeral. */
export async function handleInteraction(
  interaction: ChatInputCommandInteraction,
  deps: HandlerDeps,
): Promise<void> {
  // Every reply is ephemeral. Deferring first keeps the three second window
  // from expiring while status counts or an export run. An interaction that
  // expired before this lands rejects here, which is why the caller guards it.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const request = requestFrom(interaction);
  if (!request) {
    await interaction.editReply({
      content: "That subcommand is not available in this build. Re-run the register script.",
    });
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
      {
        configs: deps.configs,
        pipeline: deps.pipeline,
        audit: deps.audit,
        pairs: deps.pairs,
        hashUid: deps.hashUid,
      },
    );
    await interaction.editReply({
      content: reply.content,
      files: (reply.files ?? []).map(
        (file) => new AttachmentBuilder(Buffer.from(file.content, "utf8"), { name: file.name }),
      ),
    });
  } catch (err) {
    // Log the failure without the command's arguments: they name accounts.
    report(deps, `/${COMMAND_NAME} ${request.name}`, err);
    // The reply itself can fail too, on an interaction that has since expired.
    await guarded(deps, `/${COMMAND_NAME} ${request.name} reply`, async () => {
      await interaction.editReply({
        content: "That command failed and nothing was changed. Check the bot's logs.",
      });
    });
  }
}

/**
 * Wire the gateway listeners. Both bodies are guarded, and an Events.Error
 * listener catches anything discord.js re-emits from a rejected listener
 * promise, so a failure in one guild cannot end the process.
 */
export function registerHandlers(client: Client, deps: HandlerDeps): void {
  client.on(Events.MessageCreate, (message) => {
    void guarded(deps, "messageCreate", () => handleMessage(message, deps));
  });

  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== COMMAND_NAME) return;
    void guarded(deps, "interactionCreate", () => handleInteraction(interaction, deps));
  });

  client.on(Events.Error, (err) => {
    report(deps, "client", err);
  });

  client.once(Events.ClientReady, (ready) => {
    console.log(`guardian discord bot ready as ${ready.user.tag}`);
  });
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

  // Pair memory is per guild. PrismaPairStats is deliberately not wired in
  // here: the pairs table has no guild column, so its counts are the whole
  // deployment's and reporting them in one server would show another server's
  // activity (docs/PHASE1.md, open items).
  const pairBook = new MemoryPairLookup();
  const pairs: PairLookup = pairBook;

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

  // A rejection raised outside an emitter still ends the process by default.
  // The listeners above are guarded; this is the backstop for everything else.
  process.on("unhandledRejection", (reason) => {
    console.error(`guardian unhandled rejection: ${describeError(reason)}`);
  });

  registerHandlers(client, {
    configs,
    pipeline,
    pairBook,
    pairs,
    audit,
    hashUid: (id) => hashUid(id, idSalt),
  });

  await client.login(token);
}

if (process.argv[1]?.endsWith("bot.js") || process.argv[1]?.endsWith("bot.ts")) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
