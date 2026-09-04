/**
 * The hash-chained audit log, as this app reads and writes it.
 *
 * AuditLog over PrismaAuditStore in production, over the fixtures'
 * MemoryAuditStore in mock mode. Reads are filtered to the session's customer,
 * but the chain itself is global: seq is assigned across every customer under
 * an advisory lock, so a verification walks whatever slice it was given and
 * names the row that broke.
 */

import { AuditLog, PrismaAuditStore, type AuditKind, type VerifyResult } from "@guardian/audit";
import { getPrisma, isMockMode } from "../db";
import { getMockData } from "../mock/fixtures";
import type { Session } from "../auth";
import type { AuditEntryView } from "./types";

function auditSecret(): string {
  const secret = process.env.AUDIT_CHAIN_SECRET;
  if (!secret || secret === "change-me") {
    throw new Error("AUDIT_CHAIN_SECRET must be set to a real value");
  }
  return secret;
}

/** The log this app appends through. In mock mode it is the fixtures' own chain. */
export async function getAuditLog(): Promise<AuditLog> {
  if (isMockMode()) {
    const data = await getMockData();
    return data.auditLog;
  }
  const prisma = await getPrisma();
  return new AuditLog(new PrismaAuditStore(prisma as never), auditSecret());
}

export interface AppendAuditInput {
  kind: AuditKind;
  payload: Record<string, unknown>;
  ts?: Date;
}

/** Appends under the session's customer. Nothing in this app appends under another. */
export async function appendAudit(
  session: Session,
  input: AppendAuditInput,
): Promise<{ seq: number; hash: string }> {
  const log = await getAuditLog();
  const entry = await log.append({
    kind: input.kind,
    customerId: session.customerId,
    payload: input.payload,
    ...(input.ts ? { ts: input.ts } : {}),
  });
  return { seq: entry.seq, hash: entry.hash };
}

export interface AuditListOptions {
  fromSeq?: number;
  limit?: number;
  kind?: string;
}

export async function listAuditEntries(
  session: Session,
  opts: AuditListOptions = {},
): Promise<AuditEntryView[]> {
  const limit = opts.limit ?? 50;

  if (isMockMode()) {
    const data = await getMockData();
    const entries = await data.auditStore.read(opts.fromSeq ?? 1);
    return entries
      .filter((e) => e.customerId === session.customerId)
      .filter((e) => (opts.kind ? e.kind === opts.kind : true))
      .sort((a, b) => b.seq - a.seq)
      .slice(0, limit)
      .map((e) => ({ ...e, ts: new Date(e.ts) }));
  }

  const prisma = await getPrisma();
  const rows = await prisma.auditEntry.findMany({
    where: {
      customerId: session.customerId,
      ...(opts.fromSeq ? { seq: { gte: opts.fromSeq } } : {}),
      ...(opts.kind ? { kind: opts.kind } : {}),
    },
    orderBy: { seq: "desc" },
    take: limit,
  });
  return rows.map((row) => ({
    seq: row.seq,
    ts: row.ts,
    kind: row.kind,
    customerId: row.customerId,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    prevHash: row.prevHash,
    hash: row.hash,
  }));
}

/** One entry, read only. Every provenance line in the app links here. */
export async function getAuditEntry(
  session: Session,
  seq: number,
): Promise<AuditEntryView | null> {
  if (isMockMode()) {
    const data = await getMockData();
    const entries = await data.auditStore.read(seq, 1);
    const entry = entries[0];
    if (!entry || entry.seq !== seq || entry.customerId !== session.customerId) return null;
    return { ...entry, ts: new Date(entry.ts) };
  }
  const prisma = await getPrisma();
  const row = await prisma.auditEntry.findFirst({
    where: { seq, customerId: session.customerId },
  });
  if (!row) return null;
  return {
    seq: row.seq,
    ts: row.ts,
    kind: row.kind,
    customerId: row.customerId,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    prevHash: row.prevHash,
    hash: row.hash,
  };
}

/**
 * Verifies a slice of the chain. The verifier names the row that broke rather
 * than returning a bare false, because chain of custody is what makes a report
 * survive a defence motion.
 */
export async function verifyAuditChain(fromSeq = 1, limit?: number): Promise<VerifyResult> {
  const log = await getAuditLog();
  return log.verify(fromSeq, limit);
}

export async function getAuditHead(): Promise<{ seq: number; hash: string }> {
  const log = await getAuditLog();
  return log.head();
}
