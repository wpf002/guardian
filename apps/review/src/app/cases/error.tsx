"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components";
import styles from "@/components/case/Case.module.css";

export default function CasesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("case list failed to render", error);
  }, [error]);

  return (
    <div className={`container ${styles.routeState}`}>
      <ErrorState
        title="The case list could not be reached."
        unaffected="No case is lost. The scorer keeps writing and every open case is still there when this view comes back."
        onRetry={reset}
      />
    </div>
  );
}
