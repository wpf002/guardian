/**
 * Every hand-written string on the server screens, guarded at import.
 *
 * assertCopy throws, so a literal that would make a claim about a person fails
 * when this module loads rather than when a server owner reads it (rule 5).
 *
 * The rule for this file: say what a control does, in the words a server admin
 * uses, and stop. This was 380 lines. It explained the UK Online Safety Act,
 * why birthdates are never stored, what a fan out signal is, and what T0 to T3
 * mean, to somebody picking the channel their alerts go to. Every one of those
 * rules is still enforced in code. None of them needs arguing on a settings
 * screen.
 */

import { assertCopy } from "@/lib/compose";
import type { AgeBand } from "@/lib/data/types";

function c(where: string, text: string): string {
  return assertCopy(`guilds/copy.ts:${where}`, text);
}

export const PAGE = {
  listTitle: c("listTitle", "Servers"),
  listIntro: c("listIntro", "Every Discord server Guardian has been added to."),
  seesTitle: c("seesTitle", "What Guardian Can See"),
  seesCan: c("seesCan", "Messages in the channels you haven't told it to skip."),
  seesCannot: c("seesCannot", "Direct messages, voice, video or images."),
  listCaption: c("listCaption", "Servers Guardian is in"),
  backToList: c("backToList", "All Servers"),
  unnamed: c("unnamed", "New server"),
  watching: c("watching", "Watching"),
  notWatching: c("notWatching", "Not watching yet"),
  notLoaded: c(
    "notLoaded",
    "Guardian hasn't loaded this server's channels and roles yet. They show up here once the bot is online.",
  ),
} as const;

export const STATES = {
  emptyTitle: c("emptyTitle", "No servers yet"),
  emptyDetail: c("emptyDetail", "Add the Guardian bot to a Discord server and it shows up here."),
  notFoundTitle: c("notFoundTitle", "Server not found"),
  notFoundDetail: c("notFoundDetail", "This account isn't set up for that server."),
  loadingList: c("loadingList", "Loading servers."),
  loadingDetail: c("loadingDetail", "Loading this server."),
  errorListTitle: c("errorListTitle", "Servers couldn't be loaded."),
  errorDetailTitle: c("errorDetailTitle", "This server couldn't be loaded."),
  errorUnaffected: c("errorUnaffected", "Guardian is still watching. Only this page failed to load."),
} as const;

export const ALERTS = {
  title: c("alertsTitle", "Alerts"),
  label: c("alertsLabel", "Send alerts to"),
  placeholder: c("alertsPlaceholder", "Pick a channel"),
  help: c("alertsHelp", "Pick a channel only your moderators can see."),
  start: c("alertsStart", "Start Watching"),
  stop: c("alertsStop", "Stop Watching"),
  needsChannel: c("alertsNeedsChannel", "Pick a channel first."),
  started: c("alertsStarted", "Guardian is watching this server."),
  stopped: c("alertsStopped", "Guardian stopped watching this server."),
} as const;

export const AGES = {
  title: c("agesTitle", "Ages"),
  intro: c("agesIntro", "Tell Guardian which roles are for kids and which are for adults."),
  everyoneElse: c("agesEveryoneElse", "Everyone else"),
  everyoneElseHelp: c("agesEveryoneElseHelp", "Discord treats most accounts as 13 to 15."),
  add: c("agesAdd", "Add a role"),
  remove: c("agesRemove", "Remove"),
  deletedRole: c("agesDeletedRole", "Deleted role"),
} as const;

export const MODERATORS = {
  title: c("modsTitle", "Moderators"),
  intro: c("modsIntro", "Guardian expects these roles to talk to lots of members."),
  add: c("modsAdd", "Add a role"),
  none: c("modsNone", "None yet."),
} as const;

export const SKIP = {
  title: c("skipTitle", "Channels to Skip"),
  intro: c("skipIntro", "Guardian won't read these."),
  add: c("skipAdd", "Add a channel"),
  none: c("skipNone", "None. Guardian reads every channel it can see."),
  deletedChannel: c("skipDeletedChannel", "Deleted channel"),
} as const;

export const TIMEOUT = {
  title: c("timeoutTitle", "Automatic Timeout"),
  checkbox: c("timeoutCheckbox", "Time out an account when Guardian sends an alert"),
  lengthLabel: c("timeoutLength", "For"),
  confirmTitle: c("timeoutConfirmTitle", "Turn on automatic timeouts?"),
  confirmBody: c(
    "timeoutConfirmBody",
    "Guardian will time out an account before anyone has read the alert. Any moderator can lift it.",
  ),
  confirmAccept: c("timeoutConfirmAccept", "Turn On"),
  confirmCancel: c("timeoutConfirmCancel", "Cancel"),
} as const;

/** Common lengths instead of a number box. Ten minutes to a week, matching the bot. */
export const TIMEOUT_LENGTHS: { minutes: number; label: string }[] = [
  { minutes: 10, label: c("len10", "10 minutes") },
  { minutes: 60, label: c("len60", "1 hour") },
  { minutes: 1440, label: c("len1440", "1 day") },
  { minutes: 10080, label: c("len10080", "1 week") },
];

export const AGE_LABEL: Record<AgeBand, string> = {
  UNDER_9: c("ageUnder9", "Under 9"),
  A9_12: c("age9", "9 to 12"),
  A13_15: c("age13", "13 to 15"),
  A16_17: c("age16", "16 to 17"),
  A18_20: c("age18", "18 to 20"),
  A21_PLUS: c("age21", "21 and over"),
  UNKNOWN: c("ageUnknown", "Not sure"),
};

export const TABLE = {
  server: c("tableServer", "Server"),
  scoring: c("tableScoring", "Watching"),
  modChannel: c("tableModChannel", "Alerts Go To"),
  on: c("tableOn", "Yes"),
  off: c("tableOff", "Not yet"),
  notSet: c("tableNotSet", "No channel picked"),
  openLabel: c("tableOpen", "Open setup"),
} as const;

export const SAVE = {
  ok: c("saveOk", "Saved."),
  failed: c("saveFailed", "That didn't save. Try again."),
  noRow: c("saveNoRow", "This server isn't set up on this account any more. Reload the page."),
  invalid: c("saveInvalid", "That didn't save. Reload the page and try again."),
  denied: c("saveDenied", "Only an operator can change this."),
  dismiss: c("saveDismiss", "Dismiss"),
} as const;
