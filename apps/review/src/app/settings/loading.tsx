import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import styles from "@/components/settings/settings.module.css";

/**
 * The header lands immediately and is the same component the page renders, so
 * the heading does not resize or move when the reads finish. The placeholders
 * sit at the height of the cards that replace them.
 */
export default function SettingsLoading() {
  return (
    <div className={`container ${styles.page}`}>
      <PageHeader title="Settings" meta="Your seat, then the configuration behind it" />
      <div className={styles.sections}>
        <LoadingState label="Loading your seat, the lexicon and the webhook." count={4} rowHeight={180} />
      </div>
    </div>
  );
}
