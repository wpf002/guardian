"use client";

import Link from "next/link";
import { DataTable, type Column } from "@/components";
import type { AuditEntryView } from "@/lib/data/types";
import { formatUtc } from "./format";
import { KIND_WORDS } from "./kinds";
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
  /*
   * Three columns, and the third is a sentence.
   *
   * There were six: the sequence number, the time, the machine name of the
   * event, the customer id, a key-and-value dump of the payload, and a
   * truncated hash. Five of those are for somebody debugging Guardian. The
   * customer is the same on every row, because a seat only ever reads its own.
   * The hash is what the check verifies and is not something a person compares
   * by eye. The payload dump printed lexiconVersion beside a note on every row.
   *
   * What a moderator wants from this page is when something happened, what
   * happened in words, and a way into the detail. The detail page still carries
   * all of it.
   */
  const columns: Column<AuditEntryView>[] = [
    {
      key: "ts",
      header: "When",
      render: (entry) => <span className={styles.when}>{formatUtc(entry.ts)}</span>,
    },
    {
      key: "kind",
      header: "What Happened",
      render: (entry) => <span>{KIND_WORDS[entry.kind] ?? entry.kind}</span>,
    },
    {
      key: "seq",
      header: "",
      render: (entry) => (
        <Link className={styles.seq} href={`/audit/${entry.seq}`}>
          Details
        </Link>
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
