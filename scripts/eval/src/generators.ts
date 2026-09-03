/**
 * Synthetic conversation generators for the evaluation suite (DESIGN.md 10).
 *
 * Every public dataset is decoy-based, English, and old (DESIGN.md 12), and
 * none can be mirrored here. So the harness generates traffic from the
 * structures the case files describe: the six-stage ladder, the sextortion
 * script, teen-to-teen romance, and ordinary game chat. It measures whether the
 * kernel separates them at realistic base rates. It does not claim to measure
 * production precision; the first real labels come from the Discord bot.
 */

export interface Turn {
  from: "actor" | "target";
  text: string;
  /** Minutes after the conversation start. */
  at: number;
}

export interface Conversation {
  id: string;
  label: "grooming" | "sextortion" | "trafficking" | "teen_romance" | "benign";
  actorBand: "UNDER_9" | "A9_12" | "A13_15" | "A16_17" | "A18_20" | "A21_PLUS" | "UNKNOWN";
  targetBand: Conversation["actorBand"];
  turns: Turn[];
  /** True when a positive tier is the correct answer. */
  positive: boolean;
}

/** Deterministic PRNG so a run is reproducible and a regression is real. */
export class Rng {
  private state: number;

  constructor(seed = 42) {
    this.state = seed >>> 0 || 1;
  }

  next(): number {
    this.state ^= this.state << 13;
    this.state ^= this.state >>> 17;
    this.state ^= this.state << 5;
    return ((this.state >>> 0) % 1_000_000) / 1_000_000;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }

  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
}

const SMALL_TALK = [
  "hey whats up",
  "did you see the new update",
  "im so bad at this map lol",
  "wanna queue again",
  "gg that was close",
  "my internet is so laggy today",
  "what skin is that",
  "i got the new pass finally",
  "brb my mom needs me",
  "back",
  "lol",
  "thats so funny",
  "i have homework tho",
  "what did you get on the math test",
  "im watching a movie later",
  "add me to the squad",
  "who else is on",
  "this boss is impossible",
  "did you build the base yet",
  "nice fit",
];

const CONTACT = ["hey you seem cool", "you were good in that match", "nice build", "hi whats your name"];
const TRUST = [
  "i can send you some robux if you want",
  "i do art commissions, i could make you one free",
  "ill buy you the battle pass",
  "you can have my extra gift card",
];
const PROBE = [
  "are your parents home right now",
  "do they check your phone",
  "do you have your own room",
  "who else lives with you",
  "are your parents divorced",
];
const MIGRATE = [
  "add me on 👻 my snap is ryan_xx99",
  "lets talk on discord instead",
  "dm me on telegram",
  "whats your snap, easier there",
  "dont tell anyone we talk, our secret",
];
const SEXUALIZE = [
  "u single",
  "age is just a number honestly",
  "you're mature for your age",
  "send pics",
  "ill send mine first",
];
const COERCE = [
  "i will ruin your life if you dont answer",
  "send to your school if you dont pay",
  "you have 24 hours",
  "ill pick you up after school, whats your address",
];

const TEEN_ROMANCE = [
  "hey you were funny in vc",
  "u single lol",
  "wanna be my girlfriend",
  "whats your snap",
  "added you",
  "i miss you",
  "call me later",
  "my mom says i have to be off by 10",
  "youre cute",
  "see you at school",
];

const SEXTORTION = [
  "hey you look cute, wanna trade pics",
  "ill send mine first",
  "your turn",
  "i have all your friends and family list",
  "send me 200 on cashapp right now or i send this to everyone you know",
  "you have 1 hour",
];

export function benign(id: string, rng: Rng): Conversation {
  const turns: Turn[] = [];
  const count = rng.int(6, 30);
  for (let i = 0; i < count; i++) {
    turns.push({
      from: rng.next() < 0.5 ? "actor" : "target",
      text: rng.pick(SMALL_TALK),
      at: i * rng.int(1, 30),
    });
  }
  const band = rng.pick(["A9_12", "A13_15", "A16_17"] as const);
  return { id, label: "benign", actorBand: band, targetBand: band, turns, positive: false };
}

export function teenRomance(id: string, rng: Rng): Conversation {
  const turns: Turn[] = [];
  for (let i = 0; i < rng.int(8, 18); i++) {
    turns.push({
      from: rng.next() < 0.55 ? "actor" : "target",
      text: rng.next() < 0.6 ? rng.pick(TEEN_ROMANCE) : rng.pick(SMALL_TALK),
      at: i * rng.int(2, 60),
    });
  }
  const band = rng.pick(["A13_15", "A16_17"] as const);
  return { id, label: "teen_romance", actorBand: band, targetBand: band, turns, positive: false };
}

/**
 * The relationship-grooming ladder. `compression` sets how fast it runs: hours
 * for the documented fast cases, weeks for the slow ones.
 */
export function grooming(id: string, rng: Rng, compressionMinutes = 20): Conversation {
  const turns: Turn[] = [];
  let clock = 0;
  const push = (from: Turn["from"], text: string) => {
    clock += rng.int(1, compressionMinutes);
    turns.push({ from, text, at: clock });
  };

  push("actor", rng.pick(CONTACT));
  push("target", rng.pick(SMALL_TALK));
  for (let i = 0; i < rng.int(2, 6); i++) {
    push("actor", rng.pick(SMALL_TALK));
    push("target", rng.pick(SMALL_TALK));
  }
  push("actor", rng.pick(TRUST));
  push("target", "omg really");
  push("actor", rng.pick(PROBE));
  push("target", rng.pick(["no theyre at work", "yeah i have my own room", "just my mom"]));
  push("actor", rng.pick(MIGRATE));
  push("target", "ok");
  if (rng.next() < 0.6) {
    push("actor", rng.pick(SEXUALIZE));
    push("target", "idk");
  }

  return {
    id,
    label: "grooming",
    actorBand: rng.pick(["A18_20", "A21_PLUS"] as const),
    targetBand: rng.pick(["A9_12", "A13_15"] as const),
    turns,
    positive: true,
  };
}

export function sextortion(id: string, rng: Rng): Conversation {
  const turns: Turn[] = [];
  let clock = 0;
  for (const text of SEXTORTION) {
    clock += rng.int(1, 6);
    turns.push({ from: "actor", text, at: clock });
    clock += rng.int(1, 4);
    turns.push({ from: "target", text: rng.pick(["ok", "please stop", "i dont have money", "wait"]), at: clock });
  }
  return {
    id,
    label: "sextortion",
    actorBand: "UNKNOWN",
    targetBand: rng.pick(["A13_15", "A16_17"] as const),
    turns,
    positive: true,
  };
}

export function trafficking(id: string, rng: Rng): Conversation {
  const turns: Turn[] = [];
  let clock = 0;
  const script = [
    "you seem way older than your age",
    "i could get you a modeling job, cash daily",
    "are your parents strict",
    "lets talk on telegram instead",
    "i can get you a place to stay if you need",
    "ill pick you up, whats your address",
  ];
  for (const text of script) {
    clock += rng.int(30, 600);
    turns.push({ from: "actor", text, at: clock });
    clock += rng.int(5, 60);
    turns.push({ from: "target", text: rng.pick(["really", "idk", "maybe", "my mom would kill me"]), at: clock });
  }
  return {
    id,
    label: "trafficking",
    actorBand: "A21_PLUS",
    targetBand: rng.pick(["A13_15", "A16_17"] as const),
    turns,
    positive: true,
  };
}

/** Evasion rewrite: emoji codes, leet, spacing, and indirection (DESIGN.md 10). */
export function evade(conversation: Conversation, rng: Rng): Conversation {
  const map: Array<[RegExp, string[]]> = [
    [/\bsnapchat\b/gi, ["👻", "sn@p", "s n a p c h a t"]],
    [/\bsnap\b/gi, ["👻", "sn4p", "s n a p"]],
    [/\bdiscord\b/gi, ["💿", "d1sc0rd", "d i s c o r d"]],
    [/\btelegram\b/gi, ["✈️", "t3l3gram", "t e l e g r a m"]],
    [/\bparents\b/gi, ["p@rents", "pärents", "parents"]],
    [/\bcashapp\b/gi, ["c@shapp", "cash app", "💵"]],
    [/\brobux\b/gi, ["r0bux", "robux"]],
    [/\bpics\b/gi, ["pic5", "p i c s"]],
  ];

  return {
    ...conversation,
    id: `${conversation.id}-evaded`,
    turns: conversation.turns.map((turn) => {
      let text = turn.text;
      for (const [pattern, replacements] of map) {
        text = text.replace(pattern, () => rng.pick(replacements));
      }
      return { ...turn, text };
    }),
  };
}

/**
 * The hard negatives. These are the false-positive traps from DESIGN.md 5
 * written out as conversations: kids swapping handles, giveaway and trading
 * chat in a game community, children discussing their own families, friends
 * making plans, and adults talking to adults. If the gates in the pair scorer
 * are wrong, these are what floods the queue, so they carry more weight in the
 * base-rate simulation than ordinary small talk does.
 */
const PEER_HANDLE_SWAP = [
  "whats your snap",
  "its miamia03 whats urs",
  "added you",
  "add me on discord too",
  "my discord is jay#4412",
  "dm me there its easier",
  "my mom took my phone so ill be on later",
];

const GIVEAWAY_CHAT = [
  "im doing a robux giveaway at 100 subs",
  "i got the gift card from my aunt",
  "ill trade you my skin for yours",
  "who wants free nitro i have two",
  "i can buy it for you if you pay me back",
  "art commissions open, 5 dollars",
  "cashapp only for the commission",
];

const FAMILY_TALK = [
  "my parents are divorced so i switch houses",
  "im home alone till 6",
  "my mom checks my phone every sunday",
  "i share a room with my brother",
  "who else lives with you again",
  "my dad works nights",
];

const FRIEND_PLANS = [
  "wanna meet up at the mall saturday",
  "my mom can pick you up",
  "which bus do you take",
  "ill be at the park after school",
  "text me when youre outside",
];

const ADULT_CHAT = [
  "the patch notes broke my build again",
  "anyone running raids tonight",
  "i have work at 6am so im logging off",
  "my kid is finally asleep",
  "add me on discord, easier to coordinate",
  "whats your snap, ill send the screenshot",
];

export type HardNegativeKind =
  | "peer_handle_swap"
  | "giveaway"
  | "family_talk"
  | "friend_plans"
  | "adult_to_adult";

export function hardNegative(id: string, rng: Rng, kind?: HardNegativeKind): Conversation {
  const chosen =
    kind ??
    rng.pick([
      "peer_handle_swap",
      "giveaway",
      "family_talk",
      "friend_plans",
      "adult_to_adult",
    ] as const);

  const pools: Record<HardNegativeKind, readonly string[]> = {
    peer_handle_swap: PEER_HANDLE_SWAP,
    giveaway: GIVEAWAY_CHAT,
    family_talk: FAMILY_TALK,
    friend_plans: FRIEND_PLANS,
    adult_to_adult: ADULT_CHAT,
  };

  const turns: Turn[] = [];
  const pool = pools[chosen];
  const count = rng.int(6, 20);
  for (let i = 0; i < count; i++) {
    turns.push({
      from: rng.next() < 0.5 ? "actor" : "target",
      text: rng.next() < 0.7 ? rng.pick(pool) : rng.pick(SMALL_TALK),
      at: i * rng.int(1, 45),
    });
  }

  // Bands are the whole point of these cases. Peers are peers; adults are adults.
  const band =
    chosen === "adult_to_adult"
      ? rng.pick(["A18_20", "A21_PLUS"] as const)
      : rng.pick(["A9_12", "A13_15", "A16_17"] as const);

  return { id, label: "benign", actorBand: band, targetBand: band, turns, positive: false };
}

/**
 * The hardest negative of all: an adult who legitimately talks to minors in a
 * game community. A moderator, a teacher, a coach. DESIGN.md 5 says to whitelist
 * the role and still surface them, so this must not reach T2 on ordinary
 * moderation chat.
 */
export function adultToMinorBenign(id: string, rng: Rng): Conversation {
  const moderation = [
    "please keep chat clean in here",
    "thats a warning, next one is a mute",
    "the event starts at 7, everyone join vc",
    "if you have a problem with another member dm a mod",
    "we post announcements in the main channel",
    "good game everyone",
    "who won the build contest",
  ];
  const turns: Turn[] = [];
  for (let i = 0; i < rng.int(8, 24); i++) {
    turns.push({
      from: rng.next() < 0.6 ? "actor" : "target",
      text: rng.next() < 0.7 ? rng.pick(moderation) : rng.pick(SMALL_TALK),
      at: i * rng.int(1, 60),
    });
  }
  return {
    id,
    label: "benign",
    actorBand: "A21_PLUS",
    targetBand: rng.pick(["A9_12", "A13_15"] as const),
    turns,
    positive: false,
  };
}
