import type { ActorState } from "./actor.js";
import type { PairState } from "./pair.js";

/**
 * Kernel state. Feature workers are stateless; state lives here
 * (CLAUDE.md conventions). The memory implementation backs tests and the eval
 * harness. The Postgres and Redis implementations sit behind the same interface.
 */

export interface KernelStore {
  getPair(customerId: string, actorUid: string, targetUid: string): Promise<PairState | null>;
  putPair(customerId: string, actorUid: string, targetUid: string, state: PairState): Promise<void>;
  getActor(customerId: string, actorUid: string): Promise<ActorState | null>;
  putActor(customerId: string, actorUid: string, state: ActorState): Promise<void>;
  /** Hashed device and network hints belonging to accounts the operator actioned. */
  bannedHints(customerId: string): Promise<Set<string>>;
}

export class MemoryKernelStore implements KernelStore {
  private readonly pairs = new Map<string, PairState>();
  private readonly actors = new Map<string, ActorState>();
  private readonly banned = new Map<string, Set<string>>();

  async getPair(customerId: string, actorUid: string, targetUid: string): Promise<PairState | null> {
    return this.pairs.get(pairKey(customerId, actorUid, targetUid)) ?? null;
  }

  async putPair(
    customerId: string,
    actorUid: string,
    targetUid: string,
    state: PairState,
  ): Promise<void> {
    this.pairs.set(pairKey(customerId, actorUid, targetUid), state);
  }

  async getActor(customerId: string, actorUid: string): Promise<ActorState | null> {
    return this.actors.get(`${customerId}:${actorUid}`) ?? null;
  }

  async putActor(customerId: string, actorUid: string, state: ActorState): Promise<void> {
    this.actors.set(`${customerId}:${actorUid}`, state);
  }

  async bannedHints(customerId: string): Promise<Set<string>> {
    return this.banned.get(customerId) ?? new Set();
  }

  addBannedHint(customerId: string, hint: string): void {
    const set = this.banned.get(customerId) ?? new Set<string>();
    set.add(hint);
    this.banned.set(customerId, set);
  }

  pairCount(): number {
    return this.pairs.size;
  }
}

function pairKey(customerId: string, actorUid: string, targetUid: string): string {
  return `${customerId}:${actorUid}:${targetUid}`;
}
