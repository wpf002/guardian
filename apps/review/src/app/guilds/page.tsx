import { EmptyState } from "@/components";
import { GuildTable, guildCopy, isGuildReady, type GuildRow } from "@/components/guilds";
import { requireRole } from "@/lib/auth";
import { listGuildConfigs } from "@/lib/data/guilds";
import styles from "@/components/guilds/Guilds.module.css";

export const metadata = {
  title: "Discord servers",
};

const DATE = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

/**
 * Every Discord server on this account. Operator and owner only: a reviewer
 * reads cases and does not configure what the bot reads.
 */
export default async function GuildsPage() {
  const session = await requireRole("operator");
  const guilds = await listGuildConfigs(session);

  const rows: GuildRow[] = guilds.map((guild) => ({
    guildId: guild.guildId,
    scoring: isGuildReady({ enabled: guild.enabled, modChannelId: guild.modChannelId }),
    modChannelId: guild.modChannelId,
    rolesMapped: Object.keys(guild.roleBands).length,
    updatedAt: DATE.format(guild.updatedAt),
  }));

  return (
    <div className={`container ${styles.page}`}>
      <header className={styles.pageHead}>
        <h1 className={styles.pageTitle}>{guildCopy.PAGE.listTitle}</h1>
        <p className={styles.intro}>{guildCopy.PAGE.listIntro}</p>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          title={guildCopy.STATES.emptyTitle}
          detail={guildCopy.STATES.emptyDetail}
        />
      ) : (
        <GuildTable rows={rows} />
      )}
    </div>
  );
}
