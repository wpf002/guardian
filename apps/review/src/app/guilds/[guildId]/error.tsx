"use client";

import { ErrorState } from "@/components";
import { guildCopy } from "@/components/guilds";
import styles from "@/components/guilds/Guilds.module.css";

export default function GuildError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className={`container ${styles.page}`}>
      <ErrorState
        title={guildCopy.STATES.errorDetailTitle}
        unaffected={guildCopy.STATES.errorUnaffected}
        onRetry={reset}
      />
    </div>
  );
}
