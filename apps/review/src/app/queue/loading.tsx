import { LoadingState } from "@/components/LoadingState";
import styles from "./page.module.css";

/**
 * Six card skeletons at the exact card height, so nothing reflows when the rows
 * land. No shimmer and no spinner: a queue that flickers is worse than one that
 * takes a moment.
 */
export default function QueueLoading() {
  return (
    <div className={styles.page}>
      <p className={styles.loadingTitle}>Queue</p>
      <LoadingState label="Loading the queue. Six case rows." count={6} rowHeight={96} />
    </div>
  );
}
