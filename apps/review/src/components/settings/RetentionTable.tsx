import type { RetentionRow } from "@/app/settings/types";
import styles from "./settings.module.css";

/**
 * How long each kind of record is kept, read straight from RETENTION_MS: what
 * it applies to on the left, the duration on the right.
 */
export function RetentionTable({ rows }: { rows: RetentionRow[] }) {
  return (
    <dl className={styles.retention}>
      {rows.map((row) => (
        <div key={row.retentionClass} className={styles.retentionRow}>
          <dt>{row.tiers}</dt>
          <dd>{row.duration}</dd>
        </div>
      ))}
    </dl>
  );
}
