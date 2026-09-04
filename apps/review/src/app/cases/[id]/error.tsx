"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components";
import styles from "@/components/case/Case.module.css";

/**
 * A named failure with the manual retry. It says what is unaffected, because a
 * reviewer who cannot read this case needs to know the case still exists and
 * the scorer is still writing.
 */
export default function CaseError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("case detail failed to render", error);
  }, [error]);

  return (
    <div className={`container ${styles.routeState}`}>
      <ErrorState
        title="This case could not be loaded."
        unaffected="Nothing was decided and nothing was lost. The tier, the excerpts and the audit chain are unchanged, and the scorer keeps writing."
        onRetry={reset}
      />
    </div>
  );
}
