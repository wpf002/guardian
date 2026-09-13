"use client";

import Link from "next/link";
import { DataTable, type Column } from "@/components";
import { PAGE, TABLE } from "./copy";
import styles from "./Guilds.module.css";

export interface GuildRow {
  guildId: string;
  /** Null until the bot has connected to this server. */
  guildName: string | null;
  scoring: boolean;
  modChannelName: string | null;
  hasModChannel: boolean;
}

/**
 * One row per server: its name, whether Guardian is watching, and where alerts
 * go. Three columns.
 *
 * There were five. The Discord id printed under each name, a count of mapped
 * roles, and the date of the last change. None of them tells an admin anything
 * they act on from a list: whether the ages are right is a question for the
 * server's own page, and nobody picks a server by the day it was last edited.
 *
 * A client wrapper, because DataTable takes render functions and a function
 * cannot cross the server boundary.
 */
export function GuildTable({ rows }: { rows: GuildRow[] }) {
  const columns: Column<GuildRow>[] = [
    {
      key: "guildId",
      header: TABLE.server,
      render: (row) => (
        <Link className={styles.tableLink} href={`/guilds/${row.guildId}`}>
          {row.guildName ?? PAGE.unnamed}
          <span className="sr-only">{` ${TABLE.openLabel}`}</span>
        </Link>
      ),
    },
    {
      key: "scoring",
      header: TABLE.scoring,
      render: (row) => (row.scoring ? TABLE.on : TABLE.off),
    },
    {
      key: "modChannelName",
      header: TABLE.modChannel,
      render: (row) =>
        row.hasModChannel ? (row.modChannelName ? `#${row.modChannelName}` : TABLE.notSet) : TABLE.notSet,
    },
  ];

  return <DataTable caption={PAGE.listCaption} columns={columns} rows={rows} rowKey={(row) => row.guildId} />;
}
