import { z } from "zod";
import { AGE_BANDS } from "@guardian/schema";

/**
 * Per-guild configuration. The server owner declares what their roles mean;
 * Guardian does not guess a child's age from anything else, and it stores the
 * band rather than a birthdate (CLAUDE.md rule 9).
 */

export const guildConfigSchema = z.object({
  guildId: z.string(),
  /** Channel the bot posts tier alerts into. Required before scoring starts. */
  modChannelId: z.string().nullable(),
  /** Role id to age band. First match in role order wins. */
  roleBands: z.record(z.string(), z.enum(AGE_BANDS)).default({}),
  /**
   * Roles the owner vouches for: paid moderators, teachers, parents. Weighting
   * is reduced for these accounts but they are never exempt from scoring.
   */
  trustedRoleIds: z.array(z.string()).default([]),
  /**
   * Discord's own teen-by-default status. When a member has no mapped role,
   * this is the band Guardian assumes rather than UNKNOWN.
   */
  defaultBand: z.enum(AGE_BANDS).default("A13_15"),
  /** Owner opt-in. Off by default; a timeout is an enforcement action. */
  autoTimeoutOnT2: z.boolean().default(false),
  autoTimeoutMinutes: z.number().int().min(1).max(10080).default(60),
  /** Channels the owner excluded, for example an adults-only channel. */
  excludedChannelIds: z.array(z.string()).default([]),
  enabled: z.boolean().default(false),
});

export type GuildConfig = z.infer<typeof guildConfigSchema>;

export function defaultGuildConfig(guildId: string): GuildConfig {
  return guildConfigSchema.parse({ guildId, modChannelId: null });
}

export interface GuildConfigStore {
  get(guildId: string): Promise<GuildConfig | null>;
  put(config: GuildConfig): Promise<void>;
}

export class MemoryGuildConfigStore implements GuildConfigStore {
  private readonly map = new Map<string, GuildConfig>();

  async get(guildId: string): Promise<GuildConfig | null> {
    return this.map.get(guildId) ?? null;
  }

  async put(config: GuildConfig): Promise<void> {
    this.map.set(config.guildId, config);
  }
}

/**
 * Scoring is off until the owner has picked a mod channel and turned it on.
 * A bot that scores without a place to report is collecting for no purpose.
 */
export function isReady(config: GuildConfig): boolean {
  return config.enabled && config.modChannelId !== null;
}
