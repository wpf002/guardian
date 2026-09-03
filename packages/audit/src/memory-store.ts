import { GENESIS_HASH, type AuditEntry, type AuditStore } from "./chain.js";

/** In-memory store for tests and for the eval harness. */
export class MemoryAuditStore implements AuditStore {
  private readonly entries: AuditEntry[] = [];

  async head(): Promise<{ seq: number; hash: string }> {
    const last = this.entries[this.entries.length - 1];
    return last ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: GENESIS_HASH };
  }

  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }

  async read(fromSeq = 1, limit?: number): Promise<AuditEntry[]> {
    const slice = this.entries.filter((e) => e.seq >= fromSeq);
    return limit === undefined ? slice : slice.slice(0, limit);
  }

  /** Test hook. Production stores have no such method by design. */
  tamper(seq: number, mutate: (entry: AuditEntry) => void): void {
    const entry = this.entries.find((e) => e.seq === seq);
    if (!entry) throw new Error(`no entry ${seq}`);
    mutate(entry);
  }

  size(): number {
    return this.entries.length;
  }
}
