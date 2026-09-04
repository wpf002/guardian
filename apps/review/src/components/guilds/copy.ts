/**
 * Every hand-written string on the guild setup screens, guarded at import.
 *
 * assertCopy throws, so a literal that would make a claim about a person fails
 * when this module loads rather than when a server owner reads it (DESIGN-UI 3
 * and 10, CLAUDE.md rule 5). Strings built from a row go through compose at the
 * data boundary instead; there are none on this surface, because everything
 * here describes a configuration rather than a conversation.
 */

import { assertCopy } from "@/lib/compose";
import type { AgeBand, BandProvenance } from "@/lib/data/types";

function c(where: string, text: string): string {
  return assertCopy(`guilds/copy.ts:${where}`, text);
}

/** Discord ids are snowflakes. Seventeen digits today, twenty leaves room. */
export const SNOWFLAKE = /^\d{17,20}$/;

export const SNOWFLAKE_HELP = c(
  "snowflakeHelp",
  "A Discord id is 17 to 20 digits. Turn on Developer Mode in Discord, then right click the channel or role and choose Copy ID.",
);

export const SNOWFLAKE_ERROR = c(
  "snowflakeError",
  "That is not a Discord id. Expected 17 to 20 digits and nothing else.",
);

export const PAGE = {
  listTitle: c("listTitle", "Discord servers"),
  listIntro: c(
    "listIntro",
    "One row per server this account has Guardian in. A server scores nothing until it has a mod channel and scoring is turned on, so a new row starts off.",
  ),
  listCaption: c("listCaption", "Discord servers on this account"),
  detailTitle: c("detailTitle", "Server setup"),
  detailIntro: c(
    "detailIntro",
    "What Guardian reads in this server, what your roles mean, and what the bot does when a conversation reaches a tier. Every change here is written against this server and this account only.",
  ),
  backToList: c("backToList", "All servers"),
} as const;

export const STATES = {
  emptyTitle: c("emptyTitle", "No servers yet"),
  emptyDetail: c(
    "emptyDetail",
    "A server appears here once the bot has been added to it and somebody with Manage Server has started setup. Guardian reads nothing before that.",
  ),
  notFoundTitle: c("notFoundTitle", "No settings for that server"),
  notFoundDetail: c(
    "notFoundDetail",
    "This account has no settings row for that server id. If another deployment runs Guardian in the same server, its settings belong to that account and are not readable from here.",
  ),
  loadingList: c("loadingList", "Loading the servers on this account."),
  loadingDetail: c("loadingDetail", "Loading this server's settings."),
  errorListTitle: c("errorListTitle", "The server list did not load"),
  errorDetailTitle: c("errorDetailTitle", "This server's settings did not load"),
  errorUnaffected: c(
    "errorUnaffected",
    "Nothing was changed. Scoring, alerts and retention carry on with the settings already saved.",
  ),
} as const;

export const READINESS = {
  title: c("readinessTitle", "Setup checklist"),
  onWord: c("onWord", "Scoring is on in this server."),
  offWord: c("offWord", "Scoring is off in this server."),
  onDetail: c(
    "onDetail",
    "Guardian reads messages in the channels it has access to, minus the ones excluded below, and posts to the mod channel when a pair reaches T2.",
  ),
  offDetail: c(
    "offDetail",
    "Guardian reads nothing in this server until both required steps are done. A bot that scores with nowhere to report is collecting for no reason.",
  ),
  requiredWord: c("requiredWord", "required"),
  optionalWord: c("optionalWord", "optional"),
  doneWord: c("doneWord", "done"),
  todoWord: c("todoWord", "not done"),
} as const;

export const MOD_CHANNEL = {
  title: c("modChannelTitle", "Mod channel"),
  label: c("modChannelLabel", "Channel id for alerts"),
  help: c(
    "modChannelHelp",
    "The one channel Guardian posts to. Pick a channel only your moderators can read: an alert names a pair, two age bands and what was said, and that is not for the whole server.",
  ),
  clearHelp: c(
    "modChannelClearHelp",
    "Leave this empty to remove the mod channel. Scoring stops when there is nowhere to post.",
  ),
  saveLabel: c("modChannelSave", "Save mod channel"),
  saved: c("modChannelSaved", "Mod channel saved."),
} as const;

export const BANDS = {
  title: c("bandsTitle", "Roles and age bands"),
  intro: c(
    "bandsIntro",
    "Guardian reads an age band off the roles you give people. You are telling it what your own roles mean; it does not guess an age from anything a member writes.",
  ),
  noBirthdates: c(
    "noBirthdates",
    "Guardian stores the band and never a birthdate or a date of birth. A band is enough for the age gap that matters to a tier, and a birthdate is a piece of a child's identity that this product has no reason to hold.",
  ),
  provenanceNote: c(
    "provenanceNote",
    "Discord's teen by default status gives teen or adult, not a band. A band read off a role is what your members told you. Guardian treats both as estimates, records which one applied, and prints the source on every alert.",
  ),
  provenanceNoteTwo: c(
    "provenanceNoteTwo",
    "Neither one meets the highly effective age assurance test in the UK Online Safety Act. Recording which applied is what lets that be said out loud rather than assumed.",
  ),
  defaultLabel: c("bandsDefaultLabel", "Band for members with no mapped role"),
  defaultHelp: c(
    "bandsDefaultHelp",
    "Discord's own teen by default status puts most accounts at 13 to 15. Change it only if you know better about your own server.",
  ),
  legendHeading: c("bandsLegendHeading", "What each band means"),
  mappedHeading: c("bandsMappedHeading", "Mapped roles"),
  noneMapped: c(
    "bandsNoneMapped",
    "No roles are mapped yet. Every member falls back to the band above until one is.",
  ),
  addHeading: c("bandsAddHeading", "Map another role"),
  addRoleLabel: c("bandsAddRoleLabel", "Role id"),
  addBandLabel: c("bandsAddBandLabel", "Age band for that role"),
  addLabel: c("bandsAdd", "Add role"),
  duplicateError: c("bandsDuplicate", "That role is already mapped. Change the band on the row above instead."),
  removeLabel: c("bandsRemove", "Remove"),
  saveLabel: c("bandsSave", "Save role bands"),
  saved: c("bandsSaved", "Role bands saved."),
  roleLabelPrefix: c("bandsRoleLabelPrefix", "Band for role"),
} as const;

/** Six bands plus unknown, in the words a server owner reads. */
export const BAND_LABEL: Record<AgeBand, string> = {
  UNDER_9: c("bandLabelUnder9", "Under 9"),
  A9_12: c("bandLabel912", "9 to 12"),
  A13_15: c("bandLabel1315", "13 to 15"),
  A16_17: c("bandLabel1617", "16 to 17"),
  A18_20: c("bandLabel1820", "18 to 20"),
  A21_PLUS: c("bandLabel21", "21 and over"),
  UNKNOWN: c("bandLabelUnknown", "Unknown"),
};

/** What picking each band actually does, in one plain sentence. */
export const BAND_MEANING: Record<AgeBand, string> = {
  UNDER_9: c(
    "bandMeaningUnder9",
    "Primary school age. An older account writing to this band carries the heaviest age gap weight Guardian applies.",
  ),
  A9_12: c(
    "bandMeaning912",
    "The band most of the case files sit in. An adult account writing to it is weighted the same as the band above.",
  ),
  A13_15: c(
    "bandMeaning1315",
    "Where Discord's teen by default status lands. An adult account writing to it is weighted heavily; another teen writing to it is not.",
  ),
  A16_17: c(
    "bandMeaning1617",
    "Still a minor band for every tier rule. An adult writing to it is weighted, though less than the younger bands.",
  ),
  A18_20: c(
    "bandMeaning1820",
    "An adult band. Two adults talking to each other is weighted right down, because that traffic is not what this is for.",
  ),
  A21_PLUS: c(
    "bandMeaning21",
    "An adult band. Use it for staff and for roles you hand out after an adults only check.",
  ),
  UNKNOWN: c(
    "bandMeaningUnknown",
    "A real answer, not a gap. An unknown band lowers the age gap weighting rather than assuming an adult, so a role you are unsure about belongs here.",
  ),
};

export const PROVENANCE_LABEL: Record<BandProvenance, string> = {
  facial_estimate: c("provFacial", "facial age estimate"),
  government_id: c("provGovId", "government identity document"),
  os_bracket: c("provOs", "operating system age bracket"),
  server_role: c("provRole", "a role in this server"),
  platform_default: c("provPlatform", "Discord's platform default"),
  customer_declared: c("provDeclared", "declared by this account"),
  unknown: c("provUnknown", "not recorded"),
};

export const TRUSTED = {
  title: c("trustedTitle", "Trusted roles"),
  intro: c(
    "trustedIntro",
    "Mark your moderators, admins, verified adults and known parents. Guardian lowers one signal for these roles and nothing else.",
  ),
  effect: c(
    "trustedEffect",
    "A trusted role stops the fan out signal from firing on its own, because a moderator talks to a lot of members and that is not a pattern by itself.",
  ),
  limit: c(
    "trustedLimit",
    "It does not stop progression patterns and it does not stop critical signals. An account with a trusted role that reaches stage 3 and then stage 4 is reviewed at raised priority, not lowered, because standing in a community is part of the pattern the case files describe.",
  ),
  label: c("trustedLabel", "Trusted role id"),
  addLabel: c("trustedAdd", "Add trusted role"),
  none: c("trustedNone", "No trusted roles. Every account in this server is weighted the same."),
  saveLabel: c("trustedSave", "Save trusted roles"),
  saved: c("trustedSaved", "Trusted roles saved."),
  itemLabel: c("trustedItem", "Trusted role"),
} as const;

export const EXCLUDED = {
  title: c("excludedTitle", "Channels Guardian does not read"),
  intro: c(
    "excludedIntro",
    "Add a channel here and Guardian stops reading it. Use it for staff rooms, for adults only channels, and for anywhere your members would not expect a bot to be reading.",
  ),
  note: c(
    "excludedNote",
    "An excluded channel produces no events, so nothing from it reaches a tier, an alert or a bundle. Guardian cannot read direct messages at all, whatever is set here.",
  ),
  label: c("excludedLabel", "Channel id"),
  addLabel: c("excludedAdd", "Add channel"),
  none: c("excludedNone", "No channels are excluded. Guardian reads every channel it has access to."),
  saveLabel: c("excludedSave", "Save excluded channels"),
  saved: c("excludedSaved", "Excluded channels saved."),
  itemLabel: c("excludedItem", "Excluded channel"),
} as const;

export const ACTIONS = {
  title: c("actionsTitle", "What happens at each tier"),
  t0: c("actionsT0", "T0, nothing notable. No action, and the features are dropped at the end of the retention window."),
  t1: c(
    "actionsT1",
    "T1, watch. No action, ever, and this is not configurable. Guardian keeps the features for 30 days and raises the priority on that pair. Nobody is asked to look.",
  ),
  t2: c(
    "actionsT2",
    "T2, review. An alert goes to your mod channel. That part is always on, because a tier with nowhere to go is pointless. The timeout below is the only optional piece.",
  ),
  t3: c(
    "actionsT3",
    "T3, report. Not available here, and it is not a setting anyone can turn on. Only a human reviewer produces T3. Your path is the drafted bundle you read and file yourself at report.cybertip.org, as the reporter of record.",
  ),
  critical: c(
    "actionsCritical",
    "Locked: a critical signal raises a pair to T2 whatever the score says. Threat template matches, a payment demand within minutes of a media event, meetup logistics across an age gap, and a known hash verdict you supplied all do this. Nothing on this page turns it off.",
  ),
  timeoutHeading: c("actionsTimeoutHeading", "Automatic timeout at T2"),
  timeoutOptIn: c(
    "actionsTimeoutOptIn",
    "A timeout is a service action you take on your own server. It is not a finding about anyone, any moderator can lift it, and the alert always arrives with it so a person sees the same evidence. Turn this on and Guardian applies it automatically at T2.",
  ),
  timeoutSupport: c(
    "actionsTimeoutSupport",
    "Guardian holds the timeout back when the account the tier describes is itself in a minor band. The alert still goes to your mod channel. What the hold removes is friction landing on a child.",
  ),
  timeoutCheckbox: c("actionsTimeoutCheckbox", "Apply an automatic timeout at T2"),
  timeoutMinutesLabel: c("actionsTimeoutMinutes", "Timeout length in minutes"),
  timeoutMinutesHelp: c("actionsTimeoutMinutesHelp", "Between 1 minute and 10080, which is one week."),
  timeoutMinutesError: c("actionsTimeoutMinutesError", "Enter a whole number of minutes between 1 and 10080."),
  timeoutOffWord: c("actionsTimeoutOff", "Off. Guardian posts the alert and takes no action on any account."),
  confirmTitle: c("actionsConfirmTitle", "Turn on the automatic timeout?"),
  confirmBody: c(
    "actionsConfirmBody",
    "Guardian will time out the account a T2 tier was recorded on, in this server, without waiting for a moderator. The tier is a statement about a conversation pattern and not about the person, so treat the timeout as a pause on the traffic while somebody reads the alert.",
  ),
  confirmAccept: c("actionsConfirmAccept", "Yes, turn it on"),
  confirmCancel: c("actionsConfirmCancel", "Leave it off"),
  saveLabel: c("actionsSave", "Save tier actions"),
  saved: c("actionsSaved", "Tier actions saved."),
} as const;

export const ENABLE = {
  title: c("enableTitle", "Scoring"),
  turnOn: c("enableOn", "Turn scoring on"),
  turnOff: c("enableOff", "Turn scoring off"),
  needsChannel: c(
    "enableNeedsChannel",
    "Pick a mod channel first. Guardian will not score with nowhere to post.",
  ),
  onNote: c(
    "enableOnNote",
    "Members with Manage Server can see that Guardian is on by running the status command, and any member gets a plain answer about what it reads. This surface is overt by design.",
  ),
  savedOn: c("enableSavedOn", "Scoring is on."),
  savedOff: c("enableSavedOff", "Scoring is off."),
} as const;

export const BOUNDARIES = {
  title: c("boundariesTitle", "What this bot does, and what it will not do"),
  doesHeading: c("boundariesDoesHeading", "It does"),
  notHeading: c("boundariesNotHeading", "It will not"),
  does: [
    c("does1", "Read messages in the channels you have given it access to, minus the ones you excluded."),
    c("does2", "Post one alert in your mod channel when a pair reaches T2, naming the pattern, the two age bands and the elapsed time."),
    c("does3", "Apply a timeout at T2 if, and only if, you turned that on above."),
    c("does4", "Draft an evidence bundle you can read and file yourself at report.cybertip.org."),
    c("does5", "Answer any member honestly about the fact that it is running here."),
  ],
  /**
   * FORBIDDEN_ACTIONS in apps/discord-bot/src/actions.ts, in the second person.
   * The bot enforces this list; this screen states it so a server owner reads
   * the same boundary the code holds.
   */
  not: [
    c("not1", "Message the account the signals were recorded on."),
    c("not2", "Message the younger account."),
    c("not3", "Post in a public channel."),
    c("not4", "Ban or kick anybody unless you do it."),
    c("not5", "Contact law enforcement."),
    c("not6", "Publish anything outside this server."),
  ],
  closing: c(
    "boundariesClosing",
    "A tier describes a conversation pattern and never a person. Guardian holds no images or video at any point: media arrives as a hash or it is dropped at the edge.",
  ),
} as const;

export const TABLE = {
  server: c("tableServer", "Server id"),
  scoring: c("tableScoring", "Scoring"),
  modChannel: c("tableModChannel", "Mod channel"),
  roles: c("tableRoles", "Roles mapped"),
  updated: c("tableUpdated", "Last change"),
  on: c("tableOn", "On"),
  off: c("tableOff", "Off"),
  notSet: c("tableNotSet", "Not set"),
  openLabel: c("tableOpen", "Open setup"),
} as const;

export const SAVE = {
  ok: c("saveOk", "Saved."),
  failed: c("saveFailed", "That change was not saved."),
  noRow: c(
    "saveNoRow",
    "This account has no settings row for that server any more. Reload the server list.",
  ),
  denied: c("saveDenied", "That change needs an operator seat."),
  dismiss: c("saveDismiss", "Dismiss"),
} as const;
