import { REST, Routes } from "discord.js";
import { GUARDIAN_COMMAND } from "./commands.js";

/**
 * Register the /guardian command tree with Discord. Guild-scoped when
 * DISCORD_GUILD_ID is set (instant, good for the three friendly servers);
 * global otherwise (takes up to an hour to propagate).
 *
 * This is a PUT, so it replaces whatever the application had registered at
 * that scope. Run it once per deploy that changes commands.ts.
 */

export interface RegisterResult {
  scope: "guild" | "global";
  guildId: string | null;
  commands: string[];
}

export async function registerCommands(env: NodeJS.ProcessEnv = process.env): Promise<RegisterResult> {
  const token = env.DISCORD_BOT_TOKEN;
  const appId = env.DISCORD_APP_ID;
  if (!token) throw new Error("DISCORD_BOT_TOKEN is not set");
  if (!appId) throw new Error("DISCORD_APP_ID is not set");

  const guildId = env.DISCORD_GUILD_ID?.trim() || null;
  const route = guildId
    ? Routes.applicationGuildCommands(appId, guildId)
    : Routes.applicationCommands(appId);

  const rest = new REST({ version: "10" }).setToken(token);
  const registered = (await rest.put(route, { body: [GUARDIAN_COMMAND] })) as Array<{ name: string }>;

  return {
    scope: guildId ? "guild" : "global",
    guildId,
    commands: registered.map((c) => c.name),
  };
}

if (process.argv[1]?.endsWith("register.js") || process.argv[1]?.endsWith("register.ts")) {
  registerCommands()
    .then((result) => {
      const target = result.scope === "guild" ? `guild ${result.guildId}` : "all servers (global)";
      console.log(`registered /${result.commands.join(", /")} for ${target}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
