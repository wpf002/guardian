import { LoadingState } from "@/components";
import { guildCopy } from "@/components/guilds";
import styles from "@/components/guilds/Guilds.module.css";

export default function GuildLoading() {
  return (
    <div className={`container ${styles.page}`}>
      <header className={styles.pageHead}>
        <h1 className={styles.pageTitle}>{guildCopy.PAGE.detailTitle}</h1>
      </header>
      <LoadingState label={guildCopy.STATES.loadingDetail} count={4} rowHeight={140} />
    </div>
  );
}
