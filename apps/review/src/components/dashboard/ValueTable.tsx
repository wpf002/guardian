"use client";

import { DataTable, type Column } from "@/components";

/**
 * A serializable adapter over DataTable.
 *
 * DataTable takes a render function per column, and a function cannot cross the
 * server-to-client boundary, so a server component cannot hand it columns. This
 * takes plain strings, builds the render functions on the client, and keeps one
 * table implementation in the app rather than a second one on this page.
 */

export interface ValueColumn {
  key: string;
  header: string;
  /** Right aligned and tabular, for anything a reader compares down a column. */
  numeric?: boolean;
}

export type ValueRow = Record<string, string> & { key: string };

export interface ValueTableProps {
  caption: string;
  columns: ValueColumn[];
  rows: ValueRow[];
  emptyMessage?: string;
  className?: string;
}

export function ValueTable({ caption, columns, rows, emptyMessage, className }: ValueTableProps) {
  const built: Column<ValueRow>[] = columns.map((column) => ({
    key: column.key,
    header: column.header,
    numeric: column.numeric,
    render: (row: ValueRow) => row[column.key] ?? "not recorded",
  }));

  return (
    <div className={className}>
      <DataTable
        caption={caption}
        columns={built}
        rows={rows}
        rowKey={(row) => row.key}
        emptyMessage={emptyMessage}
      />
    </div>
  );
}
