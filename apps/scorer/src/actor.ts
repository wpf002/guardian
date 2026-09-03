import { isMinorBand, type ActorScore, type AgeBand } from "@guardian/schema";

/**
 * Per-actor skew and graph features (DESIGN.md 5, 6.3).
 *
 * Sentinel's insight is that an offender's message distribution drifts toward
 * the grooming index instead of averaging out. Phase 1 has no embedding model
 * in the loop, so skew here is computed over detector hit density with the same
 * recency weighting, and the embedding version drops into `skewFromDistances`
 * in phase 2 without changing the fusion interface.
 *
 * The fan-out feature is the one Roblox missed for years: a single account
 * opening conversations with many accounts in younger bands.
 */

export interface ActorState {
  actorBand: AgeBand;
  role: "member" | "moderator" | "trusted_adult" | "unknown";
  accountAgeHours: number | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  /** Rolling counters, keyed by ISO day, trimmed to 30 days. */
  daily: Record<string, { messages: number; flagged: number }>;
  /** Distinct target hashes contacted, keyed by ISO day. */
  contactsByDay: Record<string, string[]>;
  /** Target hashes in minor bands, keyed by ISO day. */
  minorContactsByDay: Record<string, string[]>;
  /** Hashed device and ip hints, for alt clustering. */
  hints: string[];
  outboundBurstMax1h: number;
  recentOutboundTs: string[];
}

export function emptyActorState(actorBand: AgeBand): ActorState {
  return {
    actorBand,
    role: "unknown",
    accountAgeHours: null,
    firstSeenAt: null,
    lastSeenAt: null,
    daily: {},
    contactsByDay: {},
    minorContactsByDay: {},
    hints: [],
    outboundBurstMax1h: 0,
    recentOutboundTs: [],
  };
}

export interface ActorObservation {
  ts: Date;
  targetUid: string | null;
  targetBand: AgeBand;
  flagged: boolean;
  accountAgeHours?: number | null;
  role?: ActorState["role"];
  hints?: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 30;
const MAX_CONTACTS_PER_DAY = 500;

export function observeActor(state: ActorState, obs: ActorObservation): ActorState {
  const day = obs.ts.toISOString().slice(0, 10);
  const next: ActorState = {
    ...state,
    daily: { ...state.daily },
    contactsByDay: { ...state.contactsByDay },
    minorContactsByDay: { ...state.minorContactsByDay },
    hints: [...state.hints],
    recentOutboundTs: [...state.recentOutboundTs],
  };

  next.firstSeenAt ??= obs.ts.toISOString();
  next.lastSeenAt = obs.ts.toISOString();
  if (obs.accountAgeHours !== undefined && obs.accountAgeHours !== null) {
    next.accountAgeHours = obs.accountAgeHours;
  }
  if (obs.role) next.role = obs.role;

  const bucket = next.daily[day] ?? { messages: 0, flagged: 0 };
  next.daily[day] = { messages: bucket.messages + 1, flagged: bucket.flagged + (obs.flagged ? 1 : 0) };

  if (obs.targetUid) {
    next.contactsByDay[day] = addContact(next.contactsByDay[day], obs.targetUid);
    if (isMinorBand(obs.targetBand)) {
      next.minorContactsByDay[day] = addContact(next.minorContactsByDay[day], obs.targetUid);
    }
  }

  for (const hint of obs.hints ?? []) {
    if (hint && !next.hints.includes(hint)) next.hints.push(hint);
  }

  next.recentOutboundTs = [...next.recentOutboundTs, obs.ts.toISOString()]
    .filter((t) => obs.ts.getTime() - new Date(t).getTime() <= 60 * 60 * 1000)
    .slice(-2000);
  next.outboundBurstMax1h = Math.max(next.outboundBurstMax1h, next.recentOutboundTs.length);

  return prune(next, obs.ts);
}

function addContact(existing: string[] | undefined, uid: string): string[] {
  const list = existing ?? [];
  if (list.includes(uid)) return list;
  if (list.length >= MAX_CONTACTS_PER_DAY) return list;
  return [...list, uid];
}

function prune(state: ActorState, now: Date): ActorState {
  const cutoff = now.getTime() - MAX_DAYS * DAY_MS;
  const keep = (day: string) => new Date(`${day}T00:00:00Z`).getTime() >= cutoff;
  state.daily = filterKeys(state.daily, keep);
  state.contactsByDay = filterKeys(state.contactsByDay, keep);
  state.minorContactsByDay = filterKeys(state.minorContactsByDay, keep);
  return state;
}

function filterKeys<T>(obj: Record<string, T>, keep: (k: string) => boolean): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(obj)) if (keep(k)) out[k] = v;
  return out;
}

export function fanOut(state: ActorState, days: number, now: Date, minorsOnly = false): number {
  const cutoff = now.getTime() - days * DAY_MS;
  const source = minorsOnly ? state.minorContactsByDay : state.contactsByDay;
  const seen = new Set<string>();
  for (const [day, uids] of Object.entries(source)) {
    if (new Date(`${day}T00:00:00Z`).getTime() < cutoff) continue;
    for (const uid of uids) seen.add(uid);
  }
  return seen.size;
}

/**
 * Recency-weighted fraction of the actor's recent messages that carried a
 * detector hit. Rising skew across many pairs is the fan-out pattern.
 */
export function skew(state: ActorState, now: Date, halfLifeDays = 7): number {
  let weighted = 0;
  let total = 0;
  for (const [day, counts] of Object.entries(state.daily)) {
    const ageDays = (now.getTime() - new Date(`${day}T00:00:00Z`).getTime()) / DAY_MS;
    if (ageDays < 0 || ageDays > MAX_DAYS) continue;
    const decay = Math.pow(0.5, ageDays / halfLifeDays);
    weighted += counts.flagged * decay;
    total += counts.messages * decay;
  }
  if (total < 5) return 0;
  return Math.min(1, weighted / total);
}

/**
 * Phase 2 hook. Given per-message distances to the grooming and benign
 * centroids, the skew is the recency-weighted fraction closer to grooming.
 * Kept here so the fusion interface does not change when embeddings land.
 */
export function skewFromDistances(
  samples: Array<{ ts: Date; groomingDistance: number; benignDistance: number }>,
  now: Date,
  halfLifeDays = 7,
): number {
  let weighted = 0;
  let total = 0;
  for (const s of samples) {
    const ageDays = (now.getTime() - s.ts.getTime()) / DAY_MS;
    if (ageDays < 0) continue;
    const decay = Math.pow(0.5, ageDays / halfLifeDays);
    total += decay;
    if (s.groomingDistance < s.benignDistance) weighted += decay;
  }
  return total === 0 ? 0 : Math.min(1, weighted / total);
}

export interface ActorScoreOptions {
  now?: Date;
  /** Hashes seen on accounts the operator has already banned. */
  bannedHints?: Set<string>;
}

export function scoreActor(
  customerId: string,
  actorUid: string,
  state: ActorState,
  opts: ActorScoreOptions = {},
): ActorScore & { rationale: string[]; altCluster: boolean } {
  const now = opts.now ?? new Date();
  const fan7 = fanOut(state, 7, now);
  const minorFan7 = fanOut(state, 7, now, true);
  const skewValue = skew(state, now);
  const altCluster = [...(opts.bannedHints ?? [])].some((h) => state.hints.includes(h));

  const rationale: string[] = [];
  let score = 0;

  // Fan-out to younger bands. Popular streamers, mods and teachers do this too,
  // which is why the role whitelist damps it rather than suppressing it.
  if (minorFan7 >= 10) {
    const term = Math.min(1.5, Math.log10(minorFan7) * 0.9);
    score += term;
    rationale.push(`Opened conversations with ${minorFan7} accounts in minor bands in 7 days.`);
  }

  if (state.role === "moderator" || state.role === "trusted_adult") {
    score *= 0.5;
    rationale.push("Account is a customer-designated trusted role, weighting reduced.");
  }

  // New account plus a high outbound rate plus no history. Only a multiplier.
  const newAccount = state.accountAgeHours !== null && state.accountAgeHours < 72;
  if (newAccount && state.outboundBurstMax1h >= 20) {
    score += 0.6;
    rationale.push(
      `Account under 72h old sent ${state.outboundBurstMax1h} messages in an hour with no prior history.`,
    );
  }

  if (altCluster) {
    score += 1.0;
    rationale.push("Device or network hint matches an account the operator already actioned.");
  }

  if (skewValue > 0.15) {
    score += skewValue * 1.5;
    rationale.push(`${Math.round(skewValue * 100)}% of recent messages carried a flagged pattern.`);
  }

  return {
    customerId,
    actorUid,
    skew: Number(skewValue.toFixed(4)),
    fanOut7d: fan7,
    minorFanOut7d: minorFan7,
    accountAgeHours: state.accountAgeHours,
    altClusterSize: altCluster ? 1 : 0,
    score: Number(score.toFixed(4)),
    rationale,
    altCluster,
  };
}
