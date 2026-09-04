import type { AgeBand, GuildConfigView } from "@/lib/data/types";

/**
 * The guild row as it crosses into a client component. Identical to
 * GuildConfigView except that updatedAt is already a string, so the boundary
 * carries no Date and a test can build one by hand.
 */
export type GuildView = Omit<GuildConfigView, "updatedAt"> & { updatedAt: string };

/** The subset of a guild row this screen can change. */
export interface GuildPatch {
  modChannelId?: string | null;
  roleBands?: Record<string, AgeBand>;
  trustedRoleIds?: string[];
  defaultBand?: AgeBand;
  autoTimeoutOnT2?: boolean;
  autoTimeoutMinutes?: number;
  excludedChannelIds?: string[];
  enabled?: boolean;
}

/**
 * What a server action returns. A message either way, because a control that
 * goes quiet on failure is a control that silently loses a setting.
 */
export type SaveResult = { ok: true; message: string } | { ok: false; message: string };

export type SaveGuild = (patch: GuildPatch) => Promise<SaveResult>;

export function toGuildView(row: GuildConfigView): GuildView {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}
