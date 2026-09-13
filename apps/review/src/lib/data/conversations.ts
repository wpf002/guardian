/**
 * Conversations as the Evidence Log names them: the two accounts, by the names
 * Guardian kept for a flagged conversation.
 *
 * The log showed "Conversation 4f2a" on every row, which is a database key, and
 * there was no way to see one conversation's history on its own. These are what
 * the log filters by and what its rows are labelled with.
 */

import { accountName } from "@/components/queue/words";
import { getPrisma, isMockMode } from "../db";
import { getMockData } from "../mock/fixtures";
import type { Session } from "../session";
import type { ConversationRef } from "./audit";

export interface Conversation {
  ref: ConversationRef;
  /** "ryan_xx99 to kai_b" */
  label: string;
}

/** Flagged conversations for this customer, most recently active first. */
export async function listConversations(session: Session, limit = 200): Promise<Conversation[]> {
  if (isMockMode()) {
    const data = await getMockData();
    return data.pairs
      .filter((pair) => pair.queue.customerId === session.customerId)
      .sort((a, b) => b.queue.updatedAt.getTime() - a.queue.updatedAt.getTime())
      .slice(0, limit)
      .map(({ queue }) => ({
        ref: { pairId: queue.pairId, actorUid: queue.actorUid, targetUid: queue.targetUid },
        label: `${accountName(queue.actorUid, queue.actorName)} to ${accountName(queue.targetUid, queue.targetName)}`,
      }));
  }

  const prisma = await getPrisma();
  const pairs = await prisma.pair.findMany({
    where: { customerId: session.customerId, tier: { in: ["T1", "T2", "T3"] } },
    select: { id: true, actorUid: true, targetUid: true },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  const uids = [...new Set(pairs.flatMap((pair) => [pair.actorUid, pair.targetUid]))];
  const names = new Map(
    (
      await prisma.accountName.findMany({
        where: { customerId: session.customerId, hashedUid: { in: uids } },
        select: { hashedUid: true, name: true },
      })
    ).map((row) => [row.hashedUid, row.name]),
  );
  return pairs.map((pair) => ({
    ref: { pairId: pair.id, actorUid: pair.actorUid, targetUid: pair.targetUid },
    label: `${accountName(pair.actorUid, names.get(pair.actorUid))} to ${accountName(pair.targetUid, names.get(pair.targetUid))}`,
  }));
}

/** Which conversation an entry is about, if it is about one on the list. */
export function conversationFor(
  payload: Record<string, unknown>,
  conversations: Conversation[],
): Conversation | null {
  return (
    conversations.find(
      (c) =>
        payload.pairId === c.ref.pairId ||
        (payload.actorUid === c.ref.actorUid && payload.targetUid === c.ref.targetUid),
    ) ?? null
  );
}
