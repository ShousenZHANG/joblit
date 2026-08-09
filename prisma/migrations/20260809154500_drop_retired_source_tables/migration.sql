-- Contract the obsolete GLOBAL source registry only after the AU-only Stage 1
-- deployment has drained, legacy FetchRuns are deleted, and Application Blob
-- inventory/reconciliation has converged (ADR-0017).
--
-- Deliberately omit IF EXISTS and CASCADE. Missing prerequisites or an
-- unexpected dependency must abort and roll back the entire migration.

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

-- Freeze every readiness input before checking it. A fresh migration replay
-- has no Users and therefore needs no Blob inventory proof; a populated
-- environment must carry the settled checkpoint produced by the protected
-- reconciler.
LOCK TABLE
  "Application",
  "ApplicationArtifact",
  "ApplicationArtifactInventoryCheckpoint",
  "FetchRun",
  "Job",
  "User"
IN SHARE ROW EXCLUSIVE MODE;

-- Stable target lock order closes the precondition-to-drop race.
LOCK TABLE "AtsBoardSource", "SourceHealth" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF to_regclass('"AtsBoardSource"') IS NULL
    OR to_regclass('"SourceHealth"') IS NULL
    OR to_regtype('"SourceHealthStatus"') IS NULL
  THEN
    RAISE EXCEPTION
      'Retired source contract prerequisites are incomplete';
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
      'Legacy Market rows remain; complete Stage 1 data retirement first';
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
      'Active orphan Application artifacts remain; reconcile them before Stage 2';
  END IF;

  IF EXISTS (SELECT 1 FROM "User")
    AND NOT EXISTS (
      SELECT 1
      FROM "ApplicationArtifactInventoryCheckpoint"
      WHERE "key" = 'vercel-applications-v1'
        AND "completedAt" IS NOT NULL
        AND "cursor" IS NULL
        AND "claimId" IS NULL
        AND "claimLeaseExpiresAt" IS NULL
        AND "scanStartedAt" IS NULL
    )
  THEN
    RAISE EXCEPTION
      'Application Blob inventory has not converged; complete it before Stage 2';
  END IF;
END
$$;

-- No CASCADE: an unexpected external dependency fails closed.
DROP TABLE "AtsBoardSource";
DROP TABLE "SourceHealth";
DROP TYPE "SourceHealthStatus";

DO $$
BEGIN
  IF to_regclass('"AtsBoardSource"') IS NOT NULL
    OR to_regclass('"SourceHealth"') IS NOT NULL
    OR to_regtype('"SourceHealthStatus"') IS NOT NULL
  THEN
    RAISE EXCEPTION
      'Retired source contract migration did not converge';
  END IF;
END
$$;

COMMIT;
