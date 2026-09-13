import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components";
import { PayloadList, entryDetail, formatUtc, kindWords } from "@/components/audit";
import { requireSession } from "@/lib/auth";
import { getAuditEntry } from "@/lib/data/audit";
import styles from "./page.module.css";

/** One record in the Evidence Log, read only. */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<{ title: string }> {
  return { title: "Evidence Log record" };
}

/**
 * One record: what happened, when, and which conversation, in words.
 *
 * It was titled "Chain entry #40" and printed the kind code, the customer id,
 * the previous entry's 64-character hash, this entry's, and every payload key
 * raw. That is what a lawyer checking the record needs, so all of it is still
 * here, folded under Technical Details. It is not what anybody else opening a
 * record is looking for.
 */
export default async function AuditEntryPage({
  params,
}: {
  params: Promise<{ seq: string }>;
}) {
  const session = await requireSession();
  const { seq: raw } = await params;
  const seq = Number.parseInt(raw, 10);
  if (!Number.isFinite(seq) || seq < 1) notFound();

  // A record under another customer reads as absent rather than forbidden,
  // because a refusal would confirm that it exists.
  const entry = await getAuditEntry(session, seq);
  if (!entry) notFound();

  const detail = entryDetail(entry.payload);
  const pairId = typeof entry.payload.pairId === "string" ? entry.payload.pairId : null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.back}>
          <Link href="/audit">Back to the Evidence Log</Link>
        </p>
        <PageHeader title={kindWords(entry.kind)} meta={<span>{formatUtc(entry.ts)}</span>} />
      </header>

      <Card title="What Happened" density="padded">
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt className={styles.key}>When</dt>
            <dd className={styles.value}>{formatUtc(entry.ts)}</dd>
          </div>
          {detail ? (
            <div className={styles.fact}>
              <dt className={styles.key}>Details</dt>
              <dd className={styles.value}>{detail}</dd>
            </div>
          ) : null}
          {pairId ? (
            <div className={styles.fact}>
              <dt className={styles.key}>Conversation</dt>
              <dd className={`${styles.value} ${styles.links}`}>
                <Link href={`/cases/${pairId}`}>Open the Conversation</Link>
                <Link href={`/audit?conversation=${encodeURIComponent(pairId)}`}>See Its History</Link>
              </dd>
            </div>
          ) : null}
          <div className={styles.fact}>
            <dt className={styles.key}>Can it change?</dt>
            <dd className={styles.value}>No. A correction is added as a new record.</dd>
          </div>
        </dl>
      </Card>

      {/*
        The raw record, for counsel. data-technical marks it as the one place a
        page may show the record's own field names and hashes, and the plain
        language test skips it for that reason and no other.
      */}
      <details className={styles.technical} data-technical>
        <summary className={styles.technicalSummary}>Technical Details</summary>
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt className={styles.key}>Record number</dt>
            <dd className={styles.value}>{entry.seq}</dd>
          </div>
          <div className={styles.fact}>
            <dt className={styles.key}>Kind</dt>
            <dd className={styles.value}>{entry.kind}</dd>
          </div>
          <div className={styles.fact}>
            <dt className={styles.key}>Customer</dt>
            <dd className={styles.value}>{entry.customerId}</dd>
          </div>
          <div className={styles.fact}>
            <dt className={styles.key}>Previous hash</dt>
            <dd className={styles.hash}>{entry.prevHash}</dd>
          </div>
          <div className={styles.fact}>
            <dt className={styles.key}>Hash</dt>
            <dd className={styles.hash}>{entry.hash}</dd>
          </div>
        </dl>
        <PayloadList payload={entry.payload} />
      </details>
    </div>
  );
}
