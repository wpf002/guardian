import { AuditLog, MemoryAuditStore, PrismaAuditStore } from "@guardian/audit";
import { Kernel, MemoryKernelStore, PrismaKernelStore } from "@guardian/scorer";
import {
  hashUid,
  newCustomerSalt,
  reportingIdentityFrom,
  reportingIdentityGaps,
} from "@guardian/schema";
import { createPrismaClient, type PrismaClient } from "@guardian/schema/db";
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
import { describeError } from "./errors.js";
import {
  COMMAND_NAME,
  handleCommand,
  MemoryPairLookup,
  type CommandRequest,
  type PairLookup,
} from "./commands.js";
import { MemoryGuildConfigStore, defaultGuildConfig, type GuildConfigStore } from "./config.js";
import { bandWithProvenance, type DiscordMessageLike, type MemberBand } from "./mapping.js";
import { BotPipeline } from "./pipeline.js";
import { PrismaGuildConfigStore, readReportingIdentity } from "./prisma-config.js";

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
    // A thread has its own channel id, so an exclusion naming the parent has to
    // be able to see the parent. Null on anything that is not a thread.
    parentChannelId: message.channel.isThread() ? (message.channel.parentId ?? null) : null,
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
  // The band and the claim behind it, reported rather than inferred (F7). A
  // member the bot cannot see carries the guild default's own claim, which is
  // whatever the owner set it to, and never a stronger one.
  const bands = (userId: string): MemberBand => {
    const member = message.guild?.members.cache.get(userId);
    if (!member) return { band: config.defaultBand, provenance: config.defaultBandProvenance };
    return bandWithProvenance([...member.roles.cache.keys()], config);
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
    if (!channel || !channel.isTextBased() || !("send" in channel)) return;

    // Client#channels is a client-wide manager and resolves any channel the bot
    // can see in any guild. The mod channel id is free text in the console, so
    // a paste from the wrong tab used to post one guild's alert, naming and
    // pinging two of its accounts, into an unrelated server. Refuse rather than
    // send: a dead mod channel an operator can see is better than a card
    // delivered somewhere nobody consented to receive it.
    const target = channel as TextChannel;

    /*
     * "post in a public channel" is the third entry in FORBIDDEN_ACTIONS and
     * nothing read that list. `/guardian setup` offers every GUILD_TEXT channel,
     * so #general is one click, and the alert names two accounts, pings them,
     * and describes a grooming trajectory. Posted where the scored accounts can
     * read it, that is Guardian telling a child they are in a case file and
     * telling the other account it has been noticed, in front of the server.
     *
     * The test is @everyone's ViewChannel on the resolved channel, which is the
     * question the rule is actually asking: not "is this named general" but
     * "can the people in this alert read it".
     */
    const everyone = target.guild?.roles?.everyone;
    if (everyone && target.permissionsFor(everyone)?.has(PermissionFlagsBits.ViewChannel)) {
      report(
        deps,
        "alert",
        new Error(
          "the configured mod channel is readable by everyone in the server, so the alert was not sent. Pick a channel only moderators can see.",
        ),
      );
      return;
    }

    if (!("guildId" in channel) || target.guildId !== message.guildId) {
      report(
        deps,
        "alert",
        new Error(
          "the configured mod channel is not in this guild, so the alert was not sent. Set it again with /guardian setup.",
        ),
      );
      return;
    }

    await target.send(alert);
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

  /*
   * With a database, everything is written: guild configuration, the chain,
   * the kernel's pair and actor state, the event rows and the evidence
   * bundles. Without one, all of it is in process and gone on restart.
   *
   * Only the first of those used to be persisted. The chain ran on a
   * MemoryAuditStore, the kernel on a MemoryKernelStore, and nothing wrote the
   * evidence_bundles table at all, so a restart forgot every trajectory a
   * grooming detector exists to accumulate, and the reviewer console showed
   * nothing from real traffic: apps/review reads pairs and bundles from
   * Postgres, and the bot wrote neither. The mod channel got an embed and the
   * console stayed empty on fixtures.
   */
  const databaseUrl = process.env.DATABASE_URL;
  /*
   * The whole client, not the narrowed GuardianDb. That interface is the slice
   * prisma-config needs; the audit store, the kernel store and the event and
   * bundle writers each need their own tables, and every one of them checks its
   * own delegate shape against the generated client at compile time.
   */
  const db: PrismaClient | null = databaseUrl ? createPrismaClient(databaseUrl) : null;
  if (!db) {
    console.warn(
      "DATABASE_URL is not set. Scores, pair state and evidence bundles are held in memory and lost on restart, and the reviewer console will show nothing from this process.",
    );
  }

  const audit = new AuditLog(
    db ? new PrismaAuditStore(db) : new MemoryAuditStore(),
    auditSecret,
  );
  const prismaStore = db ? PrismaKernelStore.fromClient(db) : null;
  const kernel = new Kernel({ store: prismaStore ?? new MemoryKernelStore() });

  // Read once, at startup. A bundle records the identity in force when it was
  // generated, and joining the customer row per export would instead record
  // whatever the row says at read time.
  const reportingIdentity = db
    ? await readReportingIdentity(db.customer, customerId)
    : reportingIdentityFrom({});
  const pipeline = new BotPipeline({
    kernel,
    audit,
    customerId,
    idSalt,
    reportingIdentity,
    persistence: db && prismaStore ? { db, store: prismaStore } : null,
  });
  for (const gap of reportingIdentityGaps(reportingIdentity)) {
    console.warn(`reporting identity: ${gap}`);
  }
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
