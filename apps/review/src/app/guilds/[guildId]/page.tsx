import Link from "next/link";
import { EmptyState, PageHeader } from "@/components";
import { GuildEditor, guildCopy, isGuildReady, toGuildView } from "@/components/guilds";
import { requireRole } from "@/lib/auth";
import { getGuildConfig } from "@/lib/data/guilds";
import { saveGuildSettings } from "../actions";
import styles from "@/components/guilds/Guilds.module.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ guildId: string }>;
}): Promise<{ title: string }> {
  const { guildId } = await params;
  const session = await requireRole("operator");
  const config = await getGuildConfig(session, guildId);
  return { title: config?.guildName ?? guildCopy.PAGE.unnamed };
}

/**
 * Setting up Guardian for one Discord server.
 *
 * The title is the server's name. It was "Server Setup" over an 18-digit id,
 * which is what the database calls the server and not what anybody else does.
 *
 * A server id this account has no row for gets the not-found state rather than
 * an error: another deployment can be in the same server, and its settings are
 * none of this account's business (rule 8).
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
      <div>
        <Link className={styles.crumb} href="/guilds">
          {guildCopy.PAGE.backToList}
        </Link>
        <PageHeader
          title={config?.guildName ?? guildCopy.PAGE.unnamed}
          meta={
            config ? (
              <span>{isGuildReady(config) ? guildCopy.PAGE.watching : guildCopy.PAGE.notWatching}</span>
            ) : null
          }
        />
      </div>

      {config ? (
        <GuildEditor config={toGuildView(config)} save={saveGuildSettings.bind(null, config.guildId)} />
      ) : (
        <EmptyState title={guildCopy.STATES.notFoundTitle} detail={guildCopy.STATES.notFoundDetail} />
      )}
    </div>
  );
}
