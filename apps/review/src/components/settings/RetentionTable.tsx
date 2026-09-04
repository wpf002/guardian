"use client";

import { DataTable, type Column } from "@/components/DataTable";
import type { RetentionRow } from "@/app/settings/types";
import styles from "./settings.module.css";

/**
 * Retention, read only, straight from RETENTION_MS. Nothing on this page can
 * change it: deletion is a scheduled job on the class a row was written with,
 * and a class that could be edited from a settings screen would not be one.
 */

const COLUMNS: Column<RetentionRow>[] = [
  {
    key: "retentionClass",
    header: "Class",
    render: (row) => <span className={styles.version}>{row.retentionClass}</span>,
  },
  { key: "tiers", header: "Applies to", render: (row) => row.tiers },
  { key: "duration", header: "Kept for", render: (row) => row.duration },
  { key: "meaning", header: "What is kept", render: (row) => row.meaning },
];

export function RetentionTable({ rows }: { rows: RetentionRow[] }) {
  return (
    <div className={styles.tableWrap}>
      <DataTable
        caption="Retention classes on this deployment"
        columns={COLUMNS}
        rows={rows}
        rowKey={(row) => row.retentionClass}
        emptyMessage="No retention classes are configured, which means something is wrong with the build."
      />
    </div>
  );
}
