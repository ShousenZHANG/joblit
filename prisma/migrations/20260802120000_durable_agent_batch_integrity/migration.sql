-- Durable Fit batch ownership. This is an expand migration: historical
-- claim:<uuid> Job projections and v1 receipts remain valid while the Runner
-- and route adapters move to FitBatchClaim authority.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TYPE "FitBatchClaimStatus" AS ENUM (
  'ACTIVE',
  'SETTLED',
  'FAILED',
  'CANCELLED',
  'SUPERSEDED'
);

CREATE TYPE "FitBatchClaimItemOutcome" AS ENUM ('SCORED', 'FAILED');

CREATE TABLE "FitBatchClaim" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "status" "FitBatchClaimStatus" NOT NULL DEFAULT 'ACTIVE',
  "protocolVersion" INTEGER NOT NULL DEFAULT 2,
  "issueKey" CHAR(64),
  "issueHash" CHAR(64),
  "promptHash" CHAR(64),
  "promptMetaHash" CHAR(64),
  "promptMeta" JSONB,
  "resumeProfileId" UUID,
  "resumeSnapshotHash" CHAR(64),
  "jobSetHash" CHAR(64),
  "executionAttemptId" UUID NOT NULL,
  "executionLeaseExpiresAt" TIMESTAMP(3),
  "lastHeartbeatAt" TIMESTAMP(3),
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledAt" TIMESTAMP(3),
  "terminalAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FitBatchClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FitBatchClaim_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FitBatchClaim_protocol_check" CHECK (
    "protocolVersion" >= 2
  ),
  CONSTRAINT "FitBatchClaim_attempt_check" CHECK (
    "attempt" >= 1
  ),
  CONSTRAINT "FitBatchClaim_hash_shape_check" CHECK (
    ("issueKey" IS NULL OR "issueKey"::text ~ '^[0-9a-f]{64}$')
    AND ("issueHash" IS NULL OR "issueHash"::text ~ '^[0-9a-f]{64}$')
    AND ("promptHash" IS NULL OR "promptHash"::text ~ '^[0-9a-f]{64}$')
    AND ("promptMetaHash" IS NULL OR "promptMetaHash"::text ~ '^[0-9a-f]{64}$')
    AND ("resumeSnapshotHash" IS NULL OR "resumeSnapshotHash"::text ~ '^[0-9a-f]{64}$')
    AND ("jobSetHash" IS NULL OR "jobSetHash"::text ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "FitBatchClaim_prompt_binding_shape_check" CHECK (
    (
      "issueKey" IS NULL
      AND "issueHash" IS NULL
      AND "promptHash" IS NULL
      AND "promptMetaHash" IS NULL
      AND "promptMeta" IS NULL
      AND "resumeProfileId" IS NULL
      AND "resumeSnapshotHash" IS NULL
      AND "jobSetHash" IS NULL
    )
    OR (
      "issueKey" IS NOT NULL
      AND "issueHash" IS NOT NULL
      AND "promptHash" IS NOT NULL
      AND "promptMetaHash" IS NOT NULL
      AND "promptMeta" IS NOT NULL
      AND "resumeProfileId" IS NOT NULL
      AND "resumeSnapshotHash" IS NOT NULL
      AND "jobSetHash" IS NOT NULL
    )
  ),
  -- ACTIVE with a NULL lease is the deliberate RELEASED/reclaimable state.
  -- Every non-ACTIVE Claim must have no live lease.
  CONSTRAINT "FitBatchClaim_lease_shape_check" CHECK (
    ("status" = 'ACTIVE') OR "executionLeaseExpiresAt" IS NULL
  ),
  CONSTRAINT "FitBatchClaim_heartbeat_shape_check" CHECK (
    "executionLeaseExpiresAt" IS NULL OR "lastHeartbeatAt" IS NOT NULL
  ),
  CONSTRAINT "FitBatchClaim_terminal_shape_check" CHECK (
    ("status" IN ('ACTIVE', 'SETTLED') AND "terminalAt" IS NULL)
    OR ("status" IN ('FAILED', 'CANCELLED', 'SUPERSEDED') AND "terminalAt" IS NOT NULL)
  ),
  CONSTRAINT "FitBatchClaim_settled_shape_check" CHECK (
    ("status" = 'SETTLED' AND "settledAt" IS NOT NULL AND "issueKey" IS NOT NULL)
    OR ("status" <> 'SETTLED' AND "settledAt" IS NULL)
  )
);

CREATE TABLE "FitBatchClaimItem" (
  "claimId" UUID NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "jobId" UUID NOT NULL,
  "outcome" "FitBatchClaimItemOutcome",
  "failureCode" TEXT,
  "releasedAt" TIMESTAMP(3),

  CONSTRAINT "FitBatchClaimItem_pkey" PRIMARY KEY ("claimId", "jobId"),
  CONSTRAINT "FitBatchClaimItem_claimId_fkey"
    FOREIGN KEY ("claimId") REFERENCES "FitBatchClaim"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FitBatchClaimItem_ordinal_check" CHECK (
    "ordinal" >= 0
  ),
  CONSTRAINT "FitBatchClaimItem_outcome_shape_check" CHECK (
    (
      "outcome" IS NULL
      AND "failureCode" IS NULL
      AND "releasedAt" IS NULL
    )
    OR (
      "outcome" = 'SCORED'
      AND "failureCode" IS NULL
      AND "releasedAt" IS NOT NULL
    )
    OR (
      "outcome" = 'FAILED'
      AND NULLIF(BTRIM("failureCode"), '') IS NOT NULL
      AND "releasedAt" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "FitBatchClaim_one_active_per_user"
  ON "FitBatchClaim"("userId")
  WHERE "status" = 'ACTIVE';
CREATE INDEX "FitBatchClaim_userId_status_lease_idx"
  ON "FitBatchClaim"("userId", "status", "executionLeaseExpiresAt");
CREATE INDEX "FitBatchClaim_userId_issueKey_updatedAt_idx"
  ON "FitBatchClaim"("userId", "issueKey", "updatedAt");
CREATE INDEX "FitBatchClaim_executionAttemptId_idx"
  ON "FitBatchClaim"("executionAttemptId");
CREATE UNIQUE INDEX "FitBatchClaimItem_claimId_ordinal_key"
  ON "FitBatchClaimItem"("claimId", "ordinal");
CREATE INDEX "FitBatchClaimItem_jobId_idx"
  ON "FitBatchClaimItem"("jobId");

ALTER TABLE "FitBatchImportReceipt"
  ADD COLUMN "protocolVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "claimId" UUID,
  ADD COLUMN "executionAttemptId" UUID;

ALTER TABLE "FitBatchImportReceipt"
  ADD CONSTRAINT "FitBatchImportReceipt_protocol_check" CHECK (
    "protocolVersion" >= 1
    AND (
      "claimId" IS NULL
      OR ("protocolVersion" >= 2 AND "executionAttemptId" IS NOT NULL)
    )
  );

CREATE UNIQUE INDEX "FitBatchImportReceipt_claimId_key"
  ON "FitBatchImportReceipt"("claimId");
ALTER TABLE "FitBatchImportReceipt"
  ADD CONSTRAINT "FitBatchImportReceipt_claimId_fkey"
  FOREIGN KEY ("claimId") REFERENCES "FitBatchClaim"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Keep the header/task snapshot stable through reconciliation and index
-- creation. The five-second lock timeout makes a busy deployment retry rather
-- than applying the invariant against a moving task set.
LOCK TABLE "ApplicationBatch", "ApplicationBatchTask"
  IN SHARE ROW EXCLUSIVE MODE;

CREATE INDEX "ApplicationBatchTask_jobId_batchId_idx"
  ON "ApplicationBatchTask"("jobId", "batchId");

-- Earlier Job deletion paths could cascade every task without reconciling the
-- parent header. Repair all historical header counts before enforcing one
-- active batch, and terminalize empty active headers so they cannot block the
-- user's queue forever.
WITH "application_batch_task_counts" AS (
  SELECT
    batch."id",
    COUNT(task."id")::INTEGER AS "taskCount"
  FROM "ApplicationBatch" AS batch
  LEFT JOIN "ApplicationBatchTask" AS task
    ON task."batchId" = batch."id"
  GROUP BY batch."id"
)
UPDATE "ApplicationBatch" AS batch
SET
  "totalCount" = counts."taskCount",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "application_batch_task_counts" AS counts
WHERE batch."id" = counts."id"
  AND batch."totalCount" IS DISTINCT FROM counts."taskCount";

UPDATE "ApplicationBatch"
SET
  "status" = 'CANCELLED',
  "completedAt" = COALESCE("completedAt", CURRENT_TIMESTAMP),
  "error" = COALESCE(
    "error",
    'Cancelled during durable batch migration because no tasks remained'
  ),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" IN ('QUEUED', 'RUNNING')
  AND "totalCount" = 0;

-- A historical header can also remain active after every surviving task is
-- terminal. Project those rows now; otherwise the new single-active guard
-- would correctly preserve a stale owner that no Runner can advance.
UPDATE "ApplicationBatch" AS batch
SET
  "status" = CASE
    WHEN EXISTS (
      SELECT 1
      FROM "ApplicationBatchTask" AS failed_task
      WHERE failed_task."batchId" = batch."id"
        AND failed_task."status" = 'FAILED'
    ) THEN 'FAILED'::"ApplicationBatchStatus"
    ELSE 'SUCCEEDED'::"ApplicationBatchStatus"
  END,
  "completedAt" = COALESCE(batch."completedAt", CURRENT_TIMESTAMP),
  "error" = CASE
    WHEN EXISTS (
      SELECT 1
      FROM "ApplicationBatchTask" AS failed_task
      WHERE failed_task."batchId" = batch."id"
        AND failed_task."status" = 'FAILED'
    ) THEN COALESCE(batch."error", 'One or more tasks failed.')
    ELSE NULL
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE batch."status" IN ('QUEUED', 'RUNNING')
  AND batch."totalCount" > 0
  AND NOT EXISTS (
    SELECT 1
    FROM "ApplicationBatchTask" AS live_task
    WHERE live_task."batchId" = batch."id"
      AND live_task."status" IN ('PENDING', 'RUNNING')
  );

-- Fail closed rather than silently choosing one of two already-active batches.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ApplicationBatch" AS batch
    WHERE batch."status" IN ('QUEUED', 'RUNNING')
      AND NOT EXISTS (
        SELECT 1
        FROM "ApplicationBatchTask" AS live_task
        WHERE live_task."batchId" = batch."id"
          AND live_task."status" IN ('PENDING', 'RUNNING')
      )
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce active ApplicationBatch ownership: a stale active header remains';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ApplicationBatch"
    WHERE "status" IN ('QUEUED', 'RUNNING')
    GROUP BY "userId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce one active ApplicationBatch per user: duplicate QUEUED/RUNNING rows exist';
  END IF;
END $$;

CREATE UNIQUE INDEX "ApplicationBatch_one_active_per_user"
  ON "ApplicationBatch"("userId")
  WHERE "status" IN ('QUEUED', 'RUNNING');

-- Migration assertions make a partial/incorrect deploy fail before commit.
DO $$
BEGIN
  IF to_regclass('"FitBatchClaim"') IS NULL
    OR to_regclass('"FitBatchClaimItem"') IS NULL
  THEN
    RAISE EXCEPTION 'Durable Fit Claim tables were not created';
  END IF;

  IF to_regclass('"FitBatchClaim_one_active_per_user"') IS NULL
    OR to_regclass('"FitBatchClaimItem_claimId_ordinal_key"') IS NULL
    OR to_regclass('"FitBatchImportReceipt_claimId_key"') IS NULL
  THEN
    RAISE EXCEPTION 'Durable Fit Claim indexes were not created';
  END IF;

  IF to_regclass('"ApplicationBatch_one_active_per_user"') IS NULL THEN
    RAISE EXCEPTION 'ApplicationBatch active-owner index was not created';
  END IF;

  IF to_regclass('"ApplicationBatchTask_jobId_batchId_idx"') IS NULL THEN
    RAISE EXCEPTION 'ApplicationBatchTask reverse lookup index was not created';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM pg_constraint
    WHERE conname IN (
      'FitBatchClaim_protocol_check',
      'FitBatchClaim_attempt_check',
      'FitBatchClaim_hash_shape_check',
      'FitBatchClaim_prompt_binding_shape_check',
      'FitBatchClaim_lease_shape_check',
      'FitBatchClaim_heartbeat_shape_check',
      'FitBatchClaim_terminal_shape_check',
      'FitBatchClaim_settled_shape_check',
      'FitBatchClaimItem_ordinal_check',
      'FitBatchClaimItem_outcome_shape_check',
      'FitBatchImportReceipt_protocol_check'
    )
  ) <> 11 THEN
    RAISE EXCEPTION 'Durable batch integrity constraints were not created';
  END IF;
END $$;

COMMIT;
