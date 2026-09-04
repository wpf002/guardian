import { LoadingState } from "@/components";
import { guildCopy } from "@/components/guilds";
import styles from "@/components/guilds/Guilds.module.css";

export default function GuildsLoading() {
  return (
    <div className={`container ${styles.page}`}>
      <header className={styles.pageHead}>
        <h1 className={styles.pageTitle}>{guildCopy.PAGE.listTitle}</h1>
      </header>
      <LoadingState label={guildCopy.STATES.loadingList} count={3} rowHeight={48} />
    </div>
  );
}
