import { LoadingState } from "@/components/LoadingState";
import styles from "@/components/settings/settings.module.css";

/**
 * The heading lands immediately and the placeholders are the height of the
 * cards that replace them, so nothing reflows when the reads finish.
 */
export default function SettingsLoading() {
  return (
    <div className={`container ${styles.page}`}>
      <h1>Settings</h1>
      <p className={styles.lede}>
        Your seat and the limits you work under, then the configuration behind them.
      </p>
      <div className={styles.sections}>
        <LoadingState label="Loading your seat, the lexicon and the webhook." count={4} rowHeight={180} />
      </div>
    </div>
  );
}
