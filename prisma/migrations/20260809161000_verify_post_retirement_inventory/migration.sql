-- The source-table contraction is harmless to the deployed AU-only Stage 1
-- binary, but the Stage 2 binary also removes its one-time retirement tool.
-- Prove that a complete Blob inventory ran after that contraction before the
-- application rollout is allowed to continue.

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

LOCK TABLE
  "Application",
  "ApplicationArtifact",
  "ApplicationArtifactInventoryCheckpoint",
  "FetchRun",
  "Job",
  "User"
IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  contract_finished_at TIMESTAMPTZ;
BEGIN
  -- Normal Prisma deployments always own this table. Raw, empty-history replay
  -- fixtures may not; only an empty environment may use that narrow bypass.
  IF to_regclass('"_prisma_migrations"') IS NULL THEN
    IF EXISTS (SELECT 1 FROM "User") THEN
      RAISE EXCEPTION
        'Migration history is unavailable for a populated Stage 2 database';
    END IF;
  ELSE
    SELECT "finished_at"
    INTO contract_finished_at
    FROM "_prisma_migrations"
    WHERE "migration_name" = '20260809154500_drop_retired_source_tables'
      AND "rolled_back_at" IS NULL
    ORDER BY "finished_at" DESC
    LIMIT 1;
  END IF;

  IF EXISTS (SELECT 1 FROM "User")
    AND contract_finished_at IS NULL
  THEN
    RAISE EXCEPTION
      'Retired source contract migration has no durable completion marker';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Job"
    WHERE "market" = 'GLOBAL'
  ) OR EXISTS (
    SELECT 1
    FROM "FetchRun"
    WHERE "market" IN ('CN', 'GLOBAL')
  ) THEN
    RAISE EXCEPTION
      'Legacy Market rows reappeared after the source contract migration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ApplicationArtifact" AS artifact
    LEFT JOIN "Job" AS job
      ON job."id" = artifact."jobId"
     AND job."userId" = artifact."userId"
    LEFT JOIN "Application" AS application
      ON application."id" = artifact."applicationId"
     AND application."userId" = artifact."userId"
    WHERE artifact."state" IN (
      'STAGED'::"ApplicationArtifactState",
      'REFERENCED'::"ApplicationArtifactState",
      'DELETE_PENDING'::"ApplicationArtifactState",
      'DELETING'::"ApplicationArtifactState"
    )
      AND (
        (artifact."jobId" IS NOT NULL AND job."id" IS NULL)
        OR (
          artifact."applicationId" IS NOT NULL
          AND application."id" IS NULL
        )
      )
  ) THEN
    RAISE EXCEPTION
      'Active orphan Application artifacts remain after source contraction';
  END IF;

  IF EXISTS (SELECT 1 FROM "User")
    AND NOT EXISTS (
      SELECT 1
      FROM "ApplicationArtifactInventoryCheckpoint"
      WHERE "key" = 'vercel-applications-v1'
        AND "completedAt" >= (
          contract_finished_at AT TIME ZONE 'UTC'
        )
        AND "cursor" IS NULL
        AND "claimId" IS NULL
        AND "claimLeaseExpiresAt" IS NULL
        AND "scanStartedAt" IS NULL
    )
  THEN
    RAISE EXCEPTION
      'A complete post-contract Blob inventory is required before Stage 2';
  END IF;
END
$$;

COMMIT;
