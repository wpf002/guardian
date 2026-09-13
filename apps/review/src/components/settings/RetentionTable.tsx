import type { RetentionRow } from "@/app/settings/types";
import styles from "./settings.module.css";

/**
 * How long each kind of record is kept, read straight from RETENTION_MS.
 *
 * A four-line list. It was a table whose first column was the internal class
 * name and whose second was the tiers each class covered.
 */
export function RetentionTable({ rows }: { rows: RetentionRow[] }) {
  return (
    <dl className={styles.retention}>
      {rows.map((row) => (
        <div key={row.retentionClass} className={styles.retentionRow}>
          <dt>{row.tiers}</dt>
          <dd>{row.meaning}</dd>
        </div>
      ))}
    </dl>
  );
}
