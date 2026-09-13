import Link from "next/link";
import { EmptyState } from "@/components";
import styles from "@/components/case/Case.module.css";

/**
 * A pair the session cannot see returns not-found rather than a 403, because a
 * 403 confirms the case exists.
 */
export default function CaseNotFound() {
  return (
    <div className={`container ${styles.routeState}`}>
      <EmptyState
        title="This conversation isn't available"
        detail="It may have been deleted on schedule, or it belongs to another organization"
        action={
          <Link className={styles.linkAction} href="/queue">
            Back to Dashboard
          </Link>
        }
      />
    </div>
  );
}
