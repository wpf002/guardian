"use client";

import Link from "next/link";
import { DataTable, type Column } from "@/components";
import { PAGE, TABLE } from "./copy";
import styles from "./Guilds.module.css";

export interface GuildRow {
  guildId: string;
  scoring: boolean;
  modChannelId: string | null;
  rolesMapped: number;
  updatedAt: string;
}

/**
 * A client wrapper, because DataTable takes render functions in its columns and
 * a function cannot cross the server boundary. Rows arrive already serialized.
 */
export function GuildTable({ rows }: { rows: GuildRow[] }) {
  const columns: Column<GuildRow>[] = [
    {
      key: "guildId",
      header: TABLE.server,
      render: (row) => (
        <Link className={styles.tableLink} href={`/guilds/${row.guildId}`}>
          <span className={styles.mono}>{row.guildId}</span>
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
      key: "modChannelId",
      header: TABLE.modChannel,
      render: (row) =>
        row.modChannelId ? <span className={styles.mono}>{row.modChannelId}</span> : TABLE.notSet,
    },
    {
      key: "rolesMapped",
      header: TABLE.roles,
      numeric: true,
      render: (row) => row.rolesMapped,
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
