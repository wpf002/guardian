-- The server's own channel and role lists, as the bot sees them.
--
-- Setting up a server meant pasting 18-digit Discord ids for the alerts
-- channel, every age role, every trusted role and every skipped channel, with
-- Developer Mode turned on to copy them. Nobody who is not a developer can do
-- that. With the names stored, the console offers a list to pick from.
--
-- Names of channels and roles the operator created. No member data.
ALTER TABLE "guild_configs" ADD COLUMN "channels" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "guild_configs" ADD COLUMN "roles" JSONB NOT NULL DEFAULT '[]';
