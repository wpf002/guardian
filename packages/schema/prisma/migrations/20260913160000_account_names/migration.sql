-- The name Discord shows for an account, kept only while that account is in a
-- conversation Guardian flagged.
--
-- Every account id Guardian stores is a per-customer salted hash (rule 8), so
-- the console could only show a moderator a code like c090f8b7 for accounts
-- they already see by name in their own server. This keeps the name beside the
-- hash, for flagged conversations only, on the same retention as the
-- conversation. The hash is still the id: nothing joins on the name.
CREATE TABLE "account_names" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "hashedUid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "retention" "RetentionClass" NOT NULL DEFAULT 'WATCH_30D',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_names_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "account_names_customerId_hashedUid_key" ON "account_names"("customerId", "hashedUid");
CREATE INDEX "account_names_customerId_expiresAt_idx" ON "account_names"("customerId", "expiresAt");

ALTER TABLE "account_names" ADD CONSTRAINT "account_names_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
