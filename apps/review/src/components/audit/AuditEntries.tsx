"use client";

import Link from "next/link";
import { DataTable, type Column } from "@/components";
import type { AuditEntryView } from "@/lib/data/types";
import { PayloadList } from "./PayloadList";
import { formatUtc, seqLabel, shortHash } from "./format";
import styles from "./AuditEntries.module.css";

/**
 * The paginated list. A client component because DataTable takes render
 * functions, which do not cross the server boundary, and because the sequence
 * link has to be the row's tab stop rather than the row itself.
 */

export interface AuditEntriesProps {
  entries: AuditEntryView[];
  /** Names the slice in words, for the caption and the screen reader. */
  caption: string;
}

export function AuditEntries({ entries, caption }: AuditEntriesProps) {
  const columns: Column<AuditEntryView>[] = [
    {
      key: "seq",
      header: "Entry",
      numeric: true,
      render: (entry) => (
        <Link className={styles.seq} href={`/audit/${entry.seq}`}>
          {seqLabel(entry.seq)}
        </Link>
      ),
    },
    {
      key: "ts",
      header: "Recorded",
      render: (entry) => <span className={styles.when}>{formatUtc(entry.ts)}</span>,
    },
    {
      key: "kind",
      header: "Kind",
      render: (entry) => <span className={styles.mono}>{entry.kind}</span>,
    },
    {
      key: "customerId",
      header: "Customer",
      render: (entry) => <span className={styles.mono}>{entry.customerId}</span>,
    },
    {
      key: "payload",
      header: "Payload",
      render: (entry) => <PayloadList payload={entry.payload} density="compact" />,
    },
    {
      key: "hash",
      header: "Hash",
      render: (entry) => (
        <span className={styles.mono} title={entry.hash}>
          {shortHash(entry.hash)}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      caption={caption}
      columns={columns}
      rows={entries}
      rowKey={(entry) => String(entry.seq)}
      emptyMessage="No entries in this slice of the chain."
    />
  );
}
