import { LoadingState } from "@/components";
import styles from "@/components/case/Case.module.css";

/**
 * The strip renders first in the real page, so the loading state names what is
 * coming rather than showing a spinner. Rows sit at their final height, so
 * nothing reflows when the case lands.
 */
export default function CaseLoading() {
  return (
    <div className={`container ${styles.routeState}`}>
      <LoadingState
        label="Loading this case: severity first, then the evidence."
        count={4}
        rowHeight={120}
      />
    </div>
  );
}
