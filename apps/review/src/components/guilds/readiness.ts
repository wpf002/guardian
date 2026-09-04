/**
 * The readiness checklist, and the one line of it that decides whether the bot
 * scores at all.
 *
 * isGuildReady mirrors isReady() in apps/discord-bot/src/config.ts exactly:
 * enabled and a mod channel, nothing else. The other four rows below are
 * quality of the setup rather than gates, and they say so, because a checklist
 * that mixes "this stops the bot" with "this makes the bot better" teaches an
 * owner to ignore both.
 */

import { ACTIONS, BANDS, ENABLE, EXCLUDED, MOD_CHANNEL, TRUSTED } from "./copy";
import type { GuildView } from "./types";

export interface ReadinessItem {
  key: string;
  label: string;
  required: boolean;
  done: boolean;
  detail: string;
}

/** Mirrors isReady() in apps/discord-bot/src/config.ts. Keep the two in step. */
export function isGuildReady(config: Pick<GuildView, "enabled" | "modChannelId">): boolean {
  return config.enabled && config.modChannelId !== null;
}

export function readiness(config: GuildView): ReadinessItem[] {
  const mapped = Object.keys(config.roleBands).length;
  return [
    {
      key: "modChannel",
      label: MOD_CHANNEL.title,
      required: true,
      done: config.modChannelId !== null,
      detail: MOD_CHANNEL.help,
    },
    {
      key: "enabled",
      label: ENABLE.title,
      required: true,
      done: config.enabled,
      detail: config.enabled ? ENABLE.onNote : ENABLE.needsChannel,
    },
    {
      key: "roleBands",
      label: BANDS.title,
      required: false,
      done: mapped > 0,
      detail: mapped > 0 ? BANDS.intro : BANDS.noneMapped,
    },
    {
      key: "trustedRoleIds",
      label: TRUSTED.title,
      required: false,
      done: config.trustedRoleIds.length > 0,
      detail: config.trustedRoleIds.length > 0 ? TRUSTED.effect : TRUSTED.none,
    },
    {
      key: "excludedChannelIds",
      label: EXCLUDED.title,
      required: false,
      done: config.excludedChannelIds.length > 0,
      detail:
        config.excludedChannelIds.length > 0 ? EXCLUDED.note : EXCLUDED.none,
    },
    {
      key: "autoTimeoutOnT2",
      label: ACTIONS.timeoutHeading,
      required: false,
      done: config.autoTimeoutOnT2,
      detail: config.autoTimeoutOnT2 ? ACTIONS.timeoutSupport : ACTIONS.timeoutOffWord,
    },
  ];
}
