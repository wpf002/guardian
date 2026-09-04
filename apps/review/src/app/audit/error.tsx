"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components";

/**
 * The chain view failed. It says what failed, what is unaffected and offers one
 * manual retry. It never retries on its own: a view that reloads itself
 * flickers between states while somebody is reading a hash off the screen.
 */
export default function AuditError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("audit chain view failed", error);
  }, [error]);

  return (
    <ErrorState
      title="The audit chain could not be read."
      unaffected="Nothing was written. The chain itself, the queue and every recorded decision are unchanged, and no entry is ever edited or removed."
      onRetry={reset}
    />
  );
}
