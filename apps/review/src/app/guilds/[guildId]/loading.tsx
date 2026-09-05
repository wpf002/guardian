import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components";
import { guildCopy } from "@/components/guilds";
import styles from "@/components/guilds/Guilds.module.css";

export default function GuildLoading() {
  return (
    <div className={`container ${styles.page}`}>
      <PageHeader title={guildCopy.PAGE.detailTitle} />
      <LoadingState label={guildCopy.STATES.loadingDetail} count={4} rowHeight={140} />
    </div>
  );
}
