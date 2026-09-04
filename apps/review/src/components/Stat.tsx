import styles from "./Stat.module.css";

export interface StatProps {
  label: string;
  /** Null renders the unavailable sentence rather than a zero. */
  value: string | number | null;
  /** Printed when value is null. Names why, so nobody reads absent as none. */
  unavailableNote?: string;
  /** Movement since the previous window, already worded by the caller. */
  delta?: string;
  /** The target this figure is measured against, from DESIGN.md 6.4. */
  target?: string;
}

export function Stat({ label, value, unavailableNote, delta, target }: StatProps) {
  return (
    <div className={styles.stat}>
      {value === null ? (
        <span className={`${styles.value} ${styles.unavailable}`}>
          {unavailableNote ?? "not enough decisions yet"}
        </span>
      ) : (
        <span className={styles.value}>{value}</span>
      )}
      <span className={styles.label}>{label}</span>
      {delta || target ? (
        <span className={styles.meta}>
          {delta ? <span className={styles.delta}>{delta}</span> : null}
          {target ? <span>{target}</span> : null}
        </span>
      ) : null}
    </div>
  );
}
