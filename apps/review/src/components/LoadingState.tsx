import styles from "./States.module.css";

export interface LoadingStateProps {
  /** Names what is loading and how much of it, so a reviewer can judge the wait. */
  label: string;
  /** Number of placeholder rows. */
  count?: number;
  /** Exact final row height in pixels, so nothing reflows when the rows land. */
  rowHeight?: number;
}

export function LoadingState({ label, count = 6, rowHeight = 76 }: LoadingStateProps) {
  return (
    <div data-state="loading">
      <p className={styles.loadingLabel} role="status">
        {label}
      </p>
      <div className={styles.skeletonList} aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <div
            key={index}
            className={styles.skeletonRow}
            style={{ height: `${rowHeight}px` }}
          />
        ))}
      </div>
    </div>
  );
}

/** The bare placeholder, when the caller has its own heading. */
export function SkeletonRows({ count = 6, height = 76 }: { count?: number; height?: number }) {
  return (
    <div className={styles.skeletonList} aria-hidden="true" data-state="loading">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={styles.skeletonRow} style={{ height: `${height}px` }} />
      ))}
    </div>
  );
}
