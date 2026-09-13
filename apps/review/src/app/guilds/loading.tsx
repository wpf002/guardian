import { LoadingState, PageHeader } from "@/components";
import { guildCopy } from "@/components/guilds";
import styles from "@/components/guilds/Guilds.module.css";

export default function GuildsLoading() {
  return (
    <div className={`container ${styles.page}`}>
      <PageHeader title={guildCopy.PAGE.listTitle} />
      <LoadingState label={guildCopy.STATES.loadingList} count={3} rowHeight={48} />
    </div>
  );
}
