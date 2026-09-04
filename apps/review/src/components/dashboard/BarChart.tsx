"use client";

import { useId, useState } from "react";
import { Button } from "@/components";
import { ValueTable, type ValueRow } from "./ValueTable";
import styles from "./BarChart.module.css";

/**
 * A horizontal bar chart as inline SVG, drawn from tokens and nothing else.
 *
 * There is no chart library here and there will not be one: a dependency that
 * ships its own palette is a second design system. The SVG is decorative and
 * hidden from assistive technology, and the same numbers are always in the DOM
 * as a table, visually hidden until the reader asks for them. That is the
 * screen-reader path and the "what is the actual number" path at once, which is
 * why the table is never unmounted.
 */

/** Bar fills, named so no component here can reach for a raw colour. */
export type BarTone = "neutral" | "t1" | "t2" | "t3";

const TONE_VAR: Record<BarTone, string> = {
  neutral: "var(--text-subtle)",
  t1: "var(--tier-t1-border)",
  t2: "var(--tier-t2-border)",
  t3: "var(--tier-t3-border)",
};

export interface BarDatum {
  key: string;
  label: string;
  /** The number the bar is drawn from. */
  value: number;
  /** The number as the reader should see it, with its unit. */
  display: string;
  /** A second column in the table and a note under the label. Optional. */
  meta?: string;
  tone?: BarTone;
}

export interface BarChartProps {
  /** Names the chart and the table. Printed by the table caption. */
  caption: string;
  data: BarDatum[];
  valueHeader: string;
  metaHeader?: string;
  /** Printed instead of the chart when there is nothing in the window. */
  emptyMessage: string;
  /** Forces the axis maximum, so two charts can share a scale. */
  max?: number;
}

const ROW_HEIGHT = 36;
const TRACK_Y = 18;
const TRACK_HEIGHT = 8;
const WIDTH = 360;

export function BarChart({
  caption,
  data,
  valueHeader,
  metaHeader,
  emptyMessage,
  max,
}: BarChartProps) {
  const [open, setOpen] = useState(false);
  const tableId = useId();

  if (data.length === 0) {
    return <p className={styles.empty}>{emptyMessage}</p>;
  }

  const ceiling = Math.max(max ?? 0, ...data.map((row) => row.value), 1);
  const height = data.length * ROW_HEIGHT + 4;

  const columns = [
    { key: "label", header: "Row" },
    { key: "value", header: valueHeader, numeric: true },
    ...(metaHeader ? [{ key: "meta", header: metaHeader }] : []),
  ];
  const rows: ValueRow[] = data.map((row) => ({
    key: row.key,
    label: row.label,
    value: row.display,
    meta: row.meta ?? "not recorded",
  }));

  return (
    <div className={styles.chart}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="presentation"
        aria-hidden="true"
        focusable="false"
      >
        {data.map((row, index) => {
          const y = index * ROW_HEIGHT;
          const filled = Math.max((row.value / ceiling) * WIDTH, row.value > 0 ? 2 : 0);
          return (
            <g key={row.key}>
              <text className={styles.label} x={0} y={y + 11}>
                {row.label}
              </text>
              <text className={styles.value} x={WIDTH} y={y + 11} textAnchor="end">
                {row.display}
              </text>
              <rect
                className={styles.track}
                x={0}
                y={y + TRACK_Y}
                width={WIDTH}
                height={TRACK_HEIGHT}
                rx={TRACK_HEIGHT / 2}
              />
              <rect
                x={0}
                y={y + TRACK_Y}
                width={filled}
                height={TRACK_HEIGHT}
                rx={TRACK_HEIGHT / 2}
                fill={TONE_VAR[row.tone ?? "neutral"]}
              />
            </g>
          );
        })}
      </svg>

      <div className={styles.toggle}>
        <Button
          variant="ghost"
          aria-expanded={open}
          aria-controls={tableId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Hide the table" : "Show the table"}
        </Button>
      </div>

      <div id={tableId} className={open ? styles.tableOpen : "sr-only"}>
        <ValueTable caption={caption} columns={columns} rows={rows} />
      </div>
    </div>
  );
}
