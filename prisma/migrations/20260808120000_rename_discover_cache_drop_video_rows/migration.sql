-- The Discover workspace and its YouTube pipeline are gone; GitHub trending
-- survives as a nav popover. Rename the table to match what it still holds,
-- and drop the video payloads, which are pure cache with no user data.
ALTER TABLE "DiscoverVideoCache" RENAME TO "DiscoverCache";

-- Postgres keeps the old index and constraint names after a table rename, so
-- rename them explicitly or Prisma sees permanent drift.
ALTER INDEX IF EXISTS "DiscoverVideoCache_expiresAt_idx" RENAME TO "DiscoverCache_expiresAt_idx";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DiscoverVideoCache_pkey'
  ) THEN
    ALTER TABLE "DiscoverCache"
      RENAME CONSTRAINT "DiscoverVideoCache_pkey" TO "DiscoverCache_pkey";
  END IF;
END $$;

-- Video payloads and the retired daily-refresh lease rows.
DELETE FROM "DiscoverCache"
WHERE "key" LIKE 'videos:%' OR "key" LIKE 'discover-refresh:%';
