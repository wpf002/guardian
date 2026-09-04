import type { AgeBand, AgeBandProvenance, Tier } from "@guardian/schema";
import { guildConfigSchema, type GuildConfig, type GuildConfigStore } from "./config.js";

/**
 * Postgres-backed guild configuration over the guild_configs table.
 *
 * The delegate types below are the minimal shape this store needs, in the
 * style of packages/audit/src/prisma-store.ts, so the bot compiles without the
 * generated client and the real PrismaClient satisfies them structurally.
 * Every row carries the customer id (CLAUDE.md rule 7) and both reads and
 * writes are scoped to that customer. The row's identity is (guildId,
 * customerId), so a second deployment sharing this database writes its own row
 * for the same guild rather than taking ownership of one it cannot read
 * (rule 8).
 */

export interface GuildConfigRow {
  guildId: string;
  customerId: string;
  modChannelId: string | null;
  /** Json column. Validated through guildConfigSchema on read. */
  roleBands: unknown;
  trustedRoleIds: string[];
  defaultBand: string;
  defaultBandProvenance: string;
  autoTimeoutOnT2: boolean;
  autoTimeoutMinutes: number;
  excludedChannelIds: string[];
  enabled: boolean;
}

export interface GuildConfigWrite {
  customerId: string;
  modChannelId: string | null;
  roleBands: Record<string, AgeBand>;
  trustedRoleIds: string[];
  defaultBand: AgeBand;
  defaultBandProvenance: AgeBandProvenance;
  autoTimeoutOnT2: boolean;
  autoTimeoutMinutes: number;
  excludedChannelIds: string[];
  enabled: boolean;
}

/** The compound key of a guild_configs row: one row per guild per customer. */
export interface GuildConfigKey {
  guildId: string;
  customerId: string;
}

export interface GuildConfigDelegate {
  findUnique(args: {
    where: { guildId_customerId: GuildConfigKey };
  }): Promise<GuildConfigRow | null>;
  upsert(args: {
    where: { guildId_customerId: GuildConfigKey };
    create: GuildConfigWrite & { guildId: string };
    update: GuildConfigWrite;
  }): Promise<unknown>;
}

export interface PairCountDelegate {
  count(args: {
    where: { customerId: string; tier: Tier; updatedAt: { gte: Date } };
  }): Promise<number>;
}

/**
 * The slice of the Prisma client the bot touches. The audit log stays in
 * process for phase 1; the Prisma audit store is listed as open in
 * docs/PHASE1.md and needs a seeded customers row before it can be wired.
 */
export interface GuardianDb {
  guildConfig: GuildConfigDelegate;
  pair: PairCountDelegate;
}

export class PrismaGuildConfigStore implements GuildConfigStore {
  constructor(
    private readonly delegate: GuildConfigDelegate,
    private readonly customerId: string,
  ) {}

  async get(guildId: string): Promise<GuildConfig | null> {
    const row = await this.delegate.findUnique({
      where: { guildId_customerId: { guildId, customerId: this.customerId } },
    });
    if (!row || row.customerId !== this.customerId) return null;
    return guildConfigSchema.parse({
      guildId: row.guildId,
      modChannelId: row.modChannelId,
      roleBands: row.roleBands ?? {},
      trustedRoleIds: row.trustedRoleIds,
      defaultBand: row.defaultBand,
      defaultBandProvenance: row.defaultBandProvenance,
      autoTimeoutOnT2: row.autoTimeoutOnT2,
      autoTimeoutMinutes: row.autoTimeoutMinutes,
      excludedChannelIds: row.excludedChannelIds,
      enabled: row.enabled,
    });
  }

  async put(config: GuildConfig): Promise<void> {
    const data: GuildConfigWrite = {
      customerId: this.customerId,
      modChannelId: config.modChannelId,
      roleBands: config.roleBands,
      trustedRoleIds: config.trustedRoleIds,
      defaultBand: config.defaultBand,
      defaultBandProvenance: config.defaultBandProvenance,
      autoTimeoutOnT2: config.autoTimeoutOnT2,
      autoTimeoutMinutes: config.autoTimeoutMinutes,
      excludedChannelIds: config.excludedChannelIds,
      enabled: config.enabled,
    };
    // Keyed on both columns. Upserting on the guild alone would rewrite the
    // customer id of a row this store cannot even read (rule 8).
    await this.delegate.upsert({
      where: { guildId_customerId: { guildId: config.guildId, customerId: this.customerId } },
      create: { guildId: config.guildId, ...data },
      update: data,
    });
  }
}

/**
 * T1 and T2 pair counts for /guardian status, read from the pairs table. The
 * table fills once the Prisma-backed KernelStore lands (docs/PHASE1.md, open
 * items); until then this reports zero and the in-memory lookup is the truth.
 */
export class PrismaPairStats {
  constructor(
    private readonly delegate: PairCountDelegate,
    private readonly customerId: string,
  ) {}

  async recentTierCounts(since: Date): Promise<{ T1: number; T2: number }> {
    const [T1, T2] = await Promise.all([
      this.delegate.count({ where: { customerId: this.customerId, tier: "T1", updatedAt: { gte: since } } }),
      this.delegate.count({ where: { customerId: this.customerId, tier: "T2", updatedAt: { gte: since } } }),
    ]);
    return { T1, T2 };
  }
}
