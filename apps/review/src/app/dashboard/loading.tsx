import { LoadingState, PageHeader } from "@/components";
import styles from "./page.module.css";

/**
 * The loading state names what is being read and how much of it, so a lead can
 * judge the wait. No spinner and no shimmer: the header is the same component
 * the page renders and the placeholders sit at the height the cards land at, so
 * nothing resizes or reflows underneath a reader.
 */
export default function DashboardLoading() {
  return (
    <div className={`container ${styles.page}`}>
      <PageHeader title="Reporting" />
      <LoadingState
        label="Reading the queue, the decision log, the retention rollup and the audit chain."
        count={5}
        rowHeight={188}
      />
    </div>
  );
}
