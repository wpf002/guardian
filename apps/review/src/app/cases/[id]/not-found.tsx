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
        title="This case is not in your queue."
        detail="It may have been decided, released or expired, or it may belong to another partition. Possession of a case link is never the thing that grants access."
        action={
          <Link className={styles.linkAction} href="/cases">
            Back to cases
          </Link>
        }
      />
    </div>
  );
}
