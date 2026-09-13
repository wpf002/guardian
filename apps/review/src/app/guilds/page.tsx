import { Card, EmptyState, PageHeader } from "@/components";
import { GuildTable, guildCopy, isGuildReady, type GuildRow } from "@/components/guilds";
import { requireRole } from "@/lib/auth";
import { listGuildConfigs } from "@/lib/data/guilds";
import styles from "@/components/guilds/Guilds.module.css";

export const metadata = {
  title: "Servers",
};

/**
 * Every Discord server Guardian is in. Operator and owner only: a reviewer reads
 * conversations and does not set up what the bot reads.
 */
export default async function GuildsPage() {
  const session = await requireRole("operator");
  const guilds = await listGuildConfigs(session);

  const rows: GuildRow[] = guilds.map((guild) => ({
    guildId: guild.guildId,
    guildName: guild.guildName,
    scoring: isGuildReady({ enabled: guild.enabled, modChannelId: guild.modChannelId }),
    modChannelName: guild.modChannelName,
    hasModChannel: guild.modChannelId !== null,
  }));

  return (
    <div className={`container ${styles.page}`}>
      <PageHeader title={guildCopy.PAGE.listTitle} about={<p>{guildCopy.PAGE.listIntro}</p>} />

      {/*
        Two lines. This was two paragraphs covering reply detection, the
        ten-minute window, role mapping, the default age and game-chat bridges.
        What an admin needs from this card is what Guardian can see and what it
        can't, and the rest is how the kernel works.
      */}
      <Card title={guildCopy.PAGE.seesTitle}>
        <div className={styles.sees}>
          <p>
            <strong>Reads:</strong> {guildCopy.PAGE.seesCan}
          </p>
          <p>
            <strong>Never reads:</strong> {guildCopy.PAGE.seesCannot}
          </p>
        </div>
      </Card>

      {rows.length === 0 ? (
        <EmptyState title={guildCopy.STATES.emptyTitle} detail={guildCopy.STATES.emptyDetail} />
      ) : (
        <GuildTable rows={rows} />
      )}
    </div>
  );
}
