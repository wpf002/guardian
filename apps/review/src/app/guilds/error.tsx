"use client";

import { ErrorState } from "@/components";
import { guildCopy } from "@/components/guilds";
import styles from "@/components/guilds/Guilds.module.css";

/**
 * Manual retry only. A settings screen that retries on its own flickers between
 * two versions of what the bot is doing, which is the one thing this page has
 * to be unambiguous about.
 */
export default function GuildsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className={`container ${styles.page}`}>
      <ErrorState
        title={guildCopy.STATES.errorListTitle}
        unaffected={guildCopy.STATES.errorUnaffected}
        onRetry={reset}
      />
    </div>
  );
}
