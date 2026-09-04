import type { SuggestedPosture, Tier } from "@guardian/schema";
import type { GuildConfig } from "./config.js";

/**
 * What the bot is allowed to do with a tier. The list of refusals is as
 * important as the list of actions (DESIGN.md 8, "must not").
 */

export type BotAction =
  | { kind: "none" }
  | { kind: "alert_mod_channel"; channelId: string }
  | { kind: "alert_and_timeout"; channelId: string; minutes: number };

export const FORBIDDEN_ACTIONS = [
  "dm the account the signals were recorded on",
  "dm the younger account",
  "post in a public channel",
  "ban or kick without the owner acting",
  "contact law enforcement",
  "publish anything outside the server",
] as const;

/**
 * The posture is a routing decision, not a severity one (ROADMAP S4). Under
 * "support" the account this tier describes is itself in a minor band, so an
 * automatic timeout would land on the child the referral is written for. The
 * alert still goes to the mod channel, and a human still looks. What the
 * posture removes is the enforcement action taken before they do.
 */
export function decideAction(
  tier: Tier,
  config: GuildConfig,
  posture: SuggestedPosture = "enforcement",
): BotAction {
  if (config.modChannelId === null) return { kind: "none" };

  switch (tier) {
    case "T0":
      return { kind: "none" };
    case "T1":
      // Watch means retain and raise priority. No human is asked to look.
      return { kind: "none" };
    case "T2":
    case "T3":
      return config.autoTimeoutOnT2 && posture !== "support"
        ? {
            kind: "alert_and_timeout",
            channelId: config.modChannelId,
            minutes: config.autoTimeoutMinutes,
          }
        : { kind: "alert_mod_channel", channelId: config.modChannelId };
  }
}

/**
 * A timeout is friction, not a verdict. The owner opted in, it is reversible,
 * and the alert always accompanies it so a human sees the same evidence.
 */
export function timeoutReason(tier: Tier): string {
  return `Automated rate limit while a moderator reviews a tier ${tier} signal. Reversible by any moderator.`;
}
