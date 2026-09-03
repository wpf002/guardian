import {
  GENESIS_HASH,
  type AppendTarget,
  type AuditEntry,
  type AuditKind,
  type AuditStore,
} from "./chain.js";

/**
 * Postgres-backed store over the audit_entries table.
 *
 * The delegate and client interfaces below are the slice of the generated
 * Prisma client this store needs, so packages/audit does not depend on a
 * generated client at build time and the generated client satisfies them
 * structurally.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** A row as read back. payload is whatever the Json column holds. */
export interface AuditEntryRow {
  seq: number;
  ts: Date;
  kind: string;
  customerId: string;
  payload: unknown;
  prevHash: string;
  hash: string;
}

/**
 * A row as written. payload is typed as a JSON object so the delegate lines
 * up with the generated client's input type for a Json column without a cast
 * at every call site.
 */
export type AuditEntryCreate = Omit<AuditEntryRow, "payload"> & { payload: JsonObject };

export interface AuditDelegate {
  findFirst(args: {
    orderBy: { seq: "desc" };
  }): Promise<AuditEntryRow | null>;
  findMany(args: {
    where: { seq: { gte: number } };
    orderBy: { seq: "asc" };
    take?: number;
  }): Promise<AuditEntryRow[]>;
  create(args: { data: AuditEntryCreate }): Promise<unknown>;
}

/** What an interactive transaction hands back: the delegate plus raw SQL. */
export interface AuditTransactionClient {
  auditEntry: AuditDelegate;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/** The generated PrismaClient, as far as this store is concerned. */
export interface AuditClient extends AuditTransactionClient {
  $transaction<T>(fn: (tx: AuditTransactionClient) => Promise<T>): Promise<T>;
}

/**
 * Key for the Postgres advisory lock that serializes appends. One constant for
 * the whole chain, since seq is global rather than per customer. Arbitrary,
 * and it only has to differ from any other advisory lock in the database.
 */
export const AUDIT_APPEND_LOCK_KEY = 4170101;

/**
 * Appends across processes (ingest, the scorer, the sweep) are serialized by a
 * transaction level advisory lock taken in withAppendLock, which AuditLog
 * uses when it is present. Construct the store with the client to get that;
 * a bare delegate still works but then the caller must serialize appends
 * itself. The primary key on seq and the unique constraints on prevHash and
 * hash are the last line of defence against two writers claiming the same
 * position.
 */
export class PrismaAuditStore implements AuditStore {
  private readonly delegate: AuditDelegate;
  private readonly client: AuditClient | null;

  constructor(source: AuditDelegate | AuditClient) {
    if (isClient(source)) {
      this.client = source;
      this.delegate = source.auditEntry;
    } else {
      this.client = null;
      this.delegate = source;
    }
  }

  async head(): Promise<{ seq: number; hash: string }> {
    const last = await this.delegate.findFirst({ orderBy: { seq: "desc" } });
    return last ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: GENESIS_HASH };
  }

  async append(entry: AuditEntry): Promise<void> {
    await this.delegate.create({
      data: {
        seq: entry.seq,
        ts: new Date(entry.ts),
        kind: entry.kind,
        customerId: entry.customerId,
        // The chain hashes canonical JSON of the payload, so anything that is
        // not plain JSON has already been rejected by the time it gets here.
        payload: entry.payload as JsonObject,
        prevHash: entry.prevHash,
        hash: entry.hash,
      },
    });
  }

  async read(fromSeq = 1, limit?: number): Promise<AuditEntry[]> {
    const rows = await this.delegate.findMany({
      where: { seq: { gte: fromSeq } },
      orderBy: { seq: "asc" },
      ...(limit === undefined ? {} : { take: limit }),
    });
    return rows.map((row) => ({
      seq: row.seq,
      ts: row.ts.toISOString(),
      kind: row.kind as AuditKind,
      customerId: row.customerId,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      prevHash: row.prevHash,
      hash: row.hash,
    }));
  }

  /**
   * Run fn inside one transaction that holds the chain's advisory lock, so
   * the head it reads is still the head when it writes. The lock is released
   * with the transaction. Without a client there is nothing to lock with and
   * fn runs against this store directly.
   */
  async withAppendLock<T>(fn: (target: AppendTarget) => Promise<T>): Promise<T> {
    if (this.client === null) return fn(this);
    return this.client.$transaction(async (tx) => {
      // executeRaw rather than queryRaw: the lock function returns void, which
      // queryRaw cannot deserialize.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(CAST(${AUDIT_APPEND_LOCK_KEY} AS bigint))`;
      return fn(new PrismaAuditStore(tx.auditEntry));
    });
  }
}

function isClient(source: AuditDelegate | AuditClient): source is AuditClient {
  return (
    typeof (source as AuditClient).$transaction === "function" &&
    typeof (source as AuditClient).auditEntry === "object"
  );
}
