import type { GuildView } from "./types";

/**
 * Whether the bot reads this server at all: turned on, with somewhere to send
 * alerts. Mirrors isReady() in apps/discord-bot/src/config.ts. Keep the two in
 * step.
 */
export function isGuildReady(config: Pick<GuildView, "enabled" | "modChannelId">): boolean {
  return config.enabled && config.modChannelId !== null;
}
