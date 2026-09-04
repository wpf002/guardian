/**
 * Discord guild configuration, scoped to the session's customer.
 *
 * The key is (guildId, customerId), never the guild alone. Two deployments can
 * share a database and both be present in one guild; each owns its own row, and
 * neither can take over the other's by writing on the guild id (CLAUDE.md
 * rule 8), so every read and write here carries the customer.
 */

import { getPrisma, isMockMode } from "../db";
import { getMockData } from "../mock/fixtures";
import type { Session } from "../auth";
import type { AgeBand, GuildConfigView } from "./types";

function toView(row: {
  guildId: string;
  customerId: string;
  modChannelId: string | null;
  roleBands: unknown;
  trustedRoleIds: string[];
  defaultBand: string;
  defaultBandProvenance: string;
  autoTimeoutOnT2: boolean;
  autoTimeoutMinutes: number;
  excludedChannelIds: string[];
  enabled: boolean;
  updatedAt: Date;
}): GuildConfigView {
  const roleBands: Record<string, AgeBand> = {};
  if (typeof row.roleBands === "object" && row.roleBands !== null) {
    for (const [roleId, band] of Object.entries(row.roleBands as Record<string, unknown>)) {
      if (typeof band === "string") roleBands[roleId] = band as AgeBand;
    }
  }
  return {
    guildId: row.guildId,
    customerId: row.customerId,
    modChannelId: row.modChannelId,
    roleBands,
    trustedRoleIds: row.trustedRoleIds,
    defaultBand: row.defaultBand as AgeBand,
    defaultBandProvenance: row.defaultBandProvenance as GuildConfigView["defaultBandProvenance"],
    autoTimeoutOnT2: row.autoTimeoutOnT2,
    autoTimeoutMinutes: row.autoTimeoutMinutes,
    excludedChannelIds: row.excludedChannelIds,
    enabled: row.enabled,
    updatedAt: row.updatedAt,
  };
}

export async function listGuildConfigs(session: Session): Promise<GuildConfigView[]> {
  if (isMockMode()) {
    const data = await getMockData();
    return data.guilds.filter((g) => g.customerId === session.customerId);
  }
  const prisma = await getPrisma();
  const rows = await prisma.guildConfig.findMany({
    where: { customerId: session.customerId },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toView);
}

export async function getGuildConfig(
  session: Session,
  guildId: string,
): Promise<GuildConfigView | null> {
  if (isMockMode()) {
    const data = await getMockData();
    return (
      data.guilds.find((g) => g.guildId === guildId && g.customerId === session.customerId) ?? null
    );
  }
  const prisma = await getPrisma();
  const row = await prisma.guildConfig.findUnique({
    where: { guildId_customerId: { guildId, customerId: session.customerId } },
  });
  return row ? toView(row) : null;
}

export type GuildConfigPatch = Partial<
  Pick<
    GuildConfigView,
    | "modChannelId"
    // The role to band map is editable from /guilds, the same way it is from
    // the bot's /guardian role command.
    | "roleBands"
    | "trustedRoleIds"
    | "defaultBand"
    | "autoTimeoutOnT2"
    | "autoTimeoutMinutes"
    | "excludedChannelIds"
    | "enabled"
  >
>;

/**
 * Updates a guild row the session's customer owns. Returns null when no such
 * row exists for this customer, so a guild id from another deployment reads as
 * not found rather than as an error naming it.
 */
export async function updateGuildConfig(
  session: Session,
  guildId: string,
  patch: GuildConfigPatch,
): Promise<GuildConfigView | null> {
  if (isMockMode()) {
    const data = await getMockData();
    const row = data.guilds.find(
      (g) => g.guildId === guildId && g.customerId === session.customerId,
    );
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date() });
    return row;
  }
  const prisma = await getPrisma();
  const updated = await prisma.guildConfig.updateMany({
    where: { guildId, customerId: session.customerId },
    data: patch,
  });
  if (updated.count === 0) return null;
  return getGuildConfig(session, guildId);
}
