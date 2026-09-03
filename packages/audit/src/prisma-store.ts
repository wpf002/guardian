import { GENESIS_HASH, type AuditEntry, type AuditKind, type AuditStore } from "./chain.js";

/**
 * Minimal shape of the Prisma client this store needs, so packages/audit does
 * not depend on a generated client at build time.
 */
export interface AuditEntryRow {
  seq: number;
  ts: Date;
  kind: string;
  customerId: string;
  payload: unknown;
  prevHash: string;
  hash: string;
}

export interface AuditDelegate {
  findFirst(args: {
    orderBy: { seq: "desc" };
  }): Promise<AuditEntryRow | null>;
  findMany(args: {
    where: { seq: { gte: number } };
    orderBy: { seq: "asc" };
    take?: number;
  }): Promise<AuditEntryRow[]>;
  create(args: { data: AuditEntryRow }): Promise<unknown>;
}

/**
 * Postgres-backed store. Appends are serialized by a transaction in the caller;
 * the unique primary key on seq is the last line of defence against two writers
 * claiming the same position.
 */
export class PrismaAuditStore implements AuditStore {
  constructor(private readonly delegate: AuditDelegate) {}

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
        payload: entry.payload,
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
}
