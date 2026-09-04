"use server";

/**
 * The only write path on this surface.
 *
 * Every action re-reads the session and re-checks the role. A server action is
 * a public endpoint, so the role gate on the page that rendered the form is
 * decoration; this is the check that counts. updateGuildConfig scopes the write
 * to the session's customer, so a guild id belonging to another deployment
 * returns no row rather than being taken over (CLAUDE.md rule 8).
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AGE_BANDS } from "@guardian/schema";
import { requireRole } from "@/lib/auth";
import { updateGuildConfig, type GuildConfigPatch } from "@/lib/data/guilds";
import { guildCopy, type SaveResult } from "@/components/guilds";

const snowflake = z.string().regex(/^\d{17,20}$/);
const band = z.enum(AGE_BANDS);

/** The same shape the client validates, checked again where it matters. */
const patchSchema = z
  .object({
    modChannelId: snowflake.nullable(),
    roleBands: z.record(snowflake, band),
    trustedRoleIds: z.array(snowflake).max(64),
    defaultBand: band,
    autoTimeoutOnT2: z.boolean(),
    autoTimeoutMinutes: z.number().int().min(1).max(10080),
    excludedChannelIds: z.array(snowflake).max(500),
    enabled: z.boolean(),
  })
  .partial()
  .strict();

export async function saveGuildSettings(
  guildId: string,
  patch: unknown,
): Promise<SaveResult> {
  const session = await requireRole("operator");

  if (!/^\d{17,20}$/.test(guildId)) {
    return { ok: false, message: guildCopy.SAVE.noRow };
  }

  const parsed = patchSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, message: guildCopy.SNOWFLAKE_ERROR };
  }
  if (Object.keys(parsed.data).length === 0) {
    return { ok: false, message: guildCopy.SAVE.failed };
  }

  const updated = await updateGuildConfig(session, guildId, parsed.data as GuildConfigPatch);
  if (!updated) {
    return { ok: false, message: guildCopy.SAVE.noRow };
  }

  revalidatePath("/guilds");
  revalidatePath(`/guilds/${guildId}`);

  return { ok: true, message: guildCopy.SAVE.ok };
}
