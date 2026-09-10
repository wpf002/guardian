-- The console listed every connected server by its Discord snowflake, because
-- the snowflake was the only thing stored about it. An 18-digit number is not
-- something an operator can recognise their own server by, and the mod channel
-- read the same way.
--
-- Both are display names Discord already gives the bot on every message. They
-- are nullable because a row written before this migration has neither, and
-- because a bot that has lost access to a guild should keep the last name it
-- saw rather than blank the row.
ALTER TABLE "guild_configs" ADD COLUMN "guildName" TEXT;
ALTER TABLE "guild_configs" ADD COLUMN "modChannelName" TEXT;
