import Link from "next/link";
import { EmptyState } from "@/components";
import { BotBoundaries, GuildEditor, guildCopy, toGuildView } from "@/components/guilds";
import { requireRole } from "@/lib/auth";
import { getGuildConfig } from "@/lib/data/guilds";
import { saveGuildSettings } from "../actions";
import styles from "@/components/guilds/Guilds.module.css";

export const metadata = {
  title: "Server setup",
};

/**
 * Setup for one Discord server.
 *
 * A guild id this account has no row for renders the empty state rather than an
 * error: another deployment can be present in the same server, and its settings
 * are none of this account's business (CLAUDE.md rule 8).
 */
export default async function GuildPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const session = await requireRole("operator");
  const config = await getGuildConfig(session, guildId);

  return (
    <div className={`container ${styles.page}`}>
      <header className={styles.pageHead}>
        <Link className={styles.crumb} href="/guilds">
          {guildCopy.PAGE.backToList}
        </Link>
        <h1 className={styles.pageTitle}>{guildCopy.PAGE.detailTitle}</h1>
        {config ? <p className={styles.mono}>{config.guildId}</p> : null}
        <p className={styles.intro}>{guildCopy.PAGE.detailIntro}</p>
      </header>

      {config ? (
        <div className={styles.sections}>
          <GuildEditor
            config={toGuildView(config)}
            save={saveGuildSettings.bind(null, config.guildId)}
          />
          <BotBoundaries />
        </div>
      ) : (
        <EmptyState
          title={guildCopy.STATES.notFoundTitle}
          detail={guildCopy.STATES.notFoundDetail}
        />
      )}
    </div>
  );
}
