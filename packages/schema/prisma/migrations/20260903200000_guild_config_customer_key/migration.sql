-- The guild_configs primary key becomes (guildId, customerId).
--
-- With guildId alone as the key, a second deployment sharing this database
-- upserted on the guild id and rewrote the customer id of a row it could not
-- read, silently taking over another customer's configuration. The compound
-- key gives each customer its own row per guild (CLAUDE.md rule 8).

-- AlterTable
ALTER TABLE "guild_configs" DROP CONSTRAINT "guild_configs_pkey";
ALTER TABLE "guild_configs" ADD CONSTRAINT "guild_configs_pkey" PRIMARY KEY ("guildId", "customerId");
