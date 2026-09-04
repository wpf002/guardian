import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components";
import { PayloadList, formatUtc, seqLabel } from "@/components/audit";
import { requireSession } from "@/lib/auth";
import { getAuditEntry } from "@/lib/data/audit";
import styles from "./page.module.css";

/** One entry, read only. Every provenance line in the app links here. */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ seq: string }>;
}): Promise<{ title: string }> {
  const { seq } = await params;
  return { title: `Chain entry #${seq}` };
}

export default async function AuditEntryPage({
  params,
}: {
  params: Promise<{ seq: string }>;
}) {
  const session = await requireSession();
  const { seq: raw } = await params;
  const seq = Number.parseInt(raw, 10);
  if (!Number.isFinite(seq) || seq < 1) notFound();

  // An entry under another customer reads as absent rather than forbidden,
  // because a refusal would confirm that it exists.
  const entry = await getAuditEntry(session, seq);
  if (!entry) notFound();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.back}>
          <Link href="/audit">Back to the chain</Link>
        </p>
        <h1 className={styles.title}>Chain entry {seqLabel(entry.seq)}</h1>
        <p className={styles.lede}>
          Recorded {formatUtc(entry.ts)} under {entry.customerId}. This entry is read only. Nothing
          in this app edits or removes a chain entry, and a correction is a new entry that points
          at this one.
        </p>
      </header>

      <Card title="Entry" density="padded">
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt className={styles.key}>Kind</dt>
            <dd className={styles.value}>{entry.kind}</dd>
          </div>
          <div className={styles.fact}>
            <dt className={styles.key}>Recorded</dt>
            <dd className={styles.value}>{formatUtc(entry.ts)}</dd>
          </div>
          <div className={styles.fact}>
            <dt className={styles.key}>Customer</dt>
            <dd className={styles.value}>{entry.customerId}</dd>
          </div>
          <div className={styles.fact}>
            <dt className={styles.key}>Points at</dt>
            <dd className={styles.hash}>{entry.prevHash}</dd>
          </div>
          <div className={styles.fact}>
            <dt className={styles.key}>Hashes to</dt>
            <dd className={styles.hash}>{entry.hash}</dd>
          </div>
        </dl>
      </Card>

      <Card title="Payload" density="padded">
        <PayloadList payload={entry.payload} />
      </Card>
    </div>
  );
}
