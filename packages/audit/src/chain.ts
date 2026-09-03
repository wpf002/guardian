import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "./canonical.js";

/**
 * Hash-chained append-only log (DESIGN.md 7, "audit"). Every score, every
 * reviewer action, every export goes through this. Chain of custody is what
 * makes a report survive a defense motion, so the verifier must name the row
 * that broke rather than just returning false (DESIGN.md 10).
 */

export const AUDIT_KINDS = [
  "event.ingested",
  "event.rejected",
  "score.assigned",
  "review.decision",
  "bundle.exported",
  "report.filed",
  "retention.deleted",
  "customer.violation",
  "lexicon.updated",
] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

export interface AuditEntry {
  seq: number;
  ts: string;
  kind: AuditKind;
  customerId: string;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

/** Chain root. A chain whose first entry does not point here is truncated. */
export const GENESIS_HASH = "0".repeat(64);

export function entryDigest(
  entry: Omit<AuditEntry, "hash">,
  secret: string,
): string {
  const material = canonicalJson({
    seq: entry.seq,
    ts: entry.ts,
    kind: entry.kind,
    customerId: entry.customerId,
    payload: entry.payload,
    prevHash: entry.prevHash,
  });
  return createHmac("sha256", secret).update(material).digest("hex");
}

export interface AuditStore {
  head(): Promise<{ seq: number; hash: string }>;
  append(entry: AuditEntry): Promise<void>;
  read(fromSeq?: number, limit?: number): Promise<AuditEntry[]>;
  /**
   * Optional. Runs fn against a head and append that are serialized with every
   * other appender, including appenders in other processes. An append reads
   * the head and writes head plus one, so without this two writers can claim
   * the same seq. A store that only one caller ever appends to may leave it
   * out.
   */
  withAppendLock?<T>(fn: (target: AppendTarget) => Promise<T>): Promise<T>;
}

/** The two store methods an append needs. */
export type AppendTarget = Pick<AuditStore, "head" | "append">;

export interface AppendInput {
  kind: AuditKind;
  customerId: string;
  payload: Record<string, unknown>;
  ts?: Date;
}

export class AuditLog {
  constructor(
    private readonly store: AuditStore,
    private readonly secret: string,
  ) {
    if (!secret || secret === "change-me") {
      throw new Error("AUDIT_CHAIN_SECRET must be set to a real value");
    }
  }

  async append(input: AppendInput): Promise<AuditEntry> {
    const write = async (target: AppendTarget): Promise<AuditEntry> => {
      const { seq, hash } = await target.head();
      const draft: Omit<AuditEntry, "hash"> = {
        seq: seq + 1,
        ts: (input.ts ?? new Date()).toISOString(),
        kind: input.kind,
        customerId: input.customerId,
        payload: input.payload,
        prevHash: hash,
      };
      const entry: AuditEntry = { ...draft, hash: entryDigest(draft, this.secret) };
      await target.append(entry);
      return entry;
    };
    return this.store.withAppendLock ? this.store.withAppendLock(write) : write(this.store);
  }

  async head(): Promise<{ seq: number; hash: string }> {
    return this.store.head();
  }

  async verify(fromSeq = 1, limit?: number): Promise<VerifyResult> {
    const entries = await this.store.read(fromSeq, limit);
    return verifyChain(entries, this.secret, fromSeq === 1 ? GENESIS_HASH : undefined);
  }
}

export type VerifyResult =
  | { ok: true; checked: number; head: string }
  | {
      ok: false;
      checked: number;
      brokenAt: number;
      reason: "hash_mismatch" | "link_mismatch" | "sequence_gap" | "root_mismatch";
      detail: string;
    };

/**
 * Walk the chain. `expectedRoot` is only supplied when verifying from the
 * beginning; a partial verification cannot know what came before it.
 */
export function verifyChain(
  entries: AuditEntry[],
  secret: string,
  expectedRoot?: string,
): VerifyResult {
  let prevHash = expectedRoot;
  let prevSeq: number | undefined;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;

    if (prevSeq !== undefined && entry.seq !== prevSeq + 1) {
      return {
        ok: false,
        checked: i,
        brokenAt: entry.seq,
        reason: "sequence_gap",
        detail: `expected seq ${prevSeq + 1}, found ${entry.seq}`,
      };
    }

    if (prevHash !== undefined && entry.prevHash !== prevHash) {
      return {
        ok: false,
        checked: i,
        brokenAt: entry.seq,
        reason: i === 0 ? "root_mismatch" : "link_mismatch",
        detail: `entry ${entry.seq} points at ${short(entry.prevHash)}, previous entry hashes to ${short(prevHash)}`,
      };
    }

    const expected = entryDigest(entry, secret);
    if (!constantTimeEqualHex(expected, entry.hash)) {
      return {
        ok: false,
        checked: i,
        brokenAt: entry.seq,
        reason: "hash_mismatch",
        detail: `entry ${entry.seq} (${entry.kind}, customer ${entry.customerId}) does not match its recorded hash`,
      };
    }

    prevHash = entry.hash;
    prevSeq = entry.seq;
  }

  return { ok: true, checked: entries.length, head: prevHash ?? GENESIS_HASH };
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

function short(hash: string): string {
  return `${hash.slice(0, 12)}...`;
}
