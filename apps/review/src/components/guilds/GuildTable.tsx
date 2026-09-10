"use client";

import Link from "next/link";
import { DataTable, type Column } from "@/components";
import { PAGE, TABLE } from "./copy";
import styles from "./Guilds.module.css";

export interface GuildRow {
  guildId: string;
  /** Null until the bot has handled a message in this server. */
  guildName: string | null;
  scoring: boolean;
  modChannelId: string | null;
  modChannelName: string | null;
  rolesMapped: number;
  updatedAt: string;
}

/**
 * A client wrapper, because DataTable takes render functions in its columns and
 * a function cannot cross the server boundary. Rows arrive already serialized.
 */
export function GuildTable({ rows }: { rows: GuildRow[] }) {
  const columns: Column<GuildRow>[] = [
    /*
      The name, with the snowflake under it.
      
      This column printed an 18-digit Discord id and nothing else, because the
      id was the only thing Guardian stored about a server. An operator looking
      at their own two rows could not tell which was which. The bot writes the
      name back from the gateway now; the id stays, small, because it is what
      somebody pastes into a Discord support thread.
    */
    {
      key: "guildId",
      header: TABLE.server,
      render: (row) => (
        <Link className={styles.tableLink} href={`/guilds/${row.guildId}`}>
          <span className={styles.serverName} data-unnamed={row.guildName ? undefined : "true"}>
            {row.guildName ?? TABLE.unnamed}
          </span>
          <span className={styles.serverId}>{row.guildId}</span>
          <span className="sr-only">{` ${TABLE.openLabel}`}</span>
        </Link>
      ),
    },
    {
      key: "scoring",
      header: TABLE.scoring,
      render: (row) => (row.scoring ? TABLE.on : TABLE.off),
    },
    // Same again: the channel had only its snowflake to show.
    {
      key: "modChannelId",
      header: TABLE.modChannel,
      render: (row) => {
        if (!row.modChannelId) return TABLE.notSet;
        return row.modChannelName ? `#${row.modChannelName}` : <span className={styles.mono}>{row.modChannelId}</span>;
      },
    },
    {
      key: "rolesMapped",
      header: TABLE.roles,
      numeric: true,
      render: (row) => (row.rolesMapped === 0 ? TABLE.noRoles : row.rolesMapped),
    },
    {
      key: "updatedAt",
      header: TABLE.updated,
      render: (row) => row.updatedAt,
    },
  ];

  return (
    <DataTable
      caption={PAGE.listCaption}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.guildId}
    />
  );
}
