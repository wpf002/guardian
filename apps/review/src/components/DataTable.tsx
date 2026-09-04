"use client";

import { useRef, useState, type ReactNode } from "react";
import styles from "./DataTable.module.css";

export interface Column<Row> {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  /** Right aligned and tabular. Use for anything a reader compares down a column. */
  numeric?: boolean;
}

export interface DataTableProps<Row> {
  /** Names the table for a screen reader and prints above it. */
  caption: string;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** Makes rows the tab stop, with up and down moving between them. */
  onSelect?: (row: Row) => void;
  emptyMessage?: string;
}

export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  onSelect,
  emptyMessage = "Nothing to show yet.",
}: DataTableProps<Row>) {
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [selected, setSelected] = useState<string | null>(null);

  function move(from: number, delta: number) {
    const body = bodyRef.current;
    if (!body) return;
    const items = Array.from(body.querySelectorAll<HTMLTableRowElement>('tr[tabindex="0"]'));
    const next = items[from + delta];
    next?.focus();
  }

  return (
    <div className={styles.scroller}>
      <table className={styles.table}>
        <caption className={styles.caption}>{caption}</caption>
        <thead className={styles.head}>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.numeric ? styles.numeric : ""}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={bodyRef}>
          {rows.length === 0 ? (
            <tr className={styles.row}>
              <td colSpan={columns.length}>{emptyMessage}</td>
            </tr>
          ) : (
            rows.map((row, index) => {
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  className={`${styles.row} ${onSelect ? styles.selectable : ""}`}
                  tabIndex={onSelect ? 0 : undefined}
                  aria-selected={onSelect ? selected === key : undefined}
                  onClick={
                    onSelect
                      ? () => {
                          setSelected(key);
                          onSelect(row);
                        }
                      : undefined
                  }
                  onKeyDown={
                    onSelect
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelected(key);
                            onSelect(row);
                          } else if (event.key === "ArrowDown") {
                            event.preventDefault();
                            move(index, 1);
                          } else if (event.key === "ArrowUp") {
                            event.preventDefault();
                            move(index, -1);
                          }
                        }
                      : undefined
                  }
                >
                  {columns.map((column) => (
                    <td key={column.key} className={column.numeric ? styles.numeric : ""}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
