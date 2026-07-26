-- FetchRunStatus.PARTIAL has existed in the Prisma model but was missing from
-- the original PostgreSQL enum migration.
ALTER TYPE "FetchRunStatus" ADD VALUE IF NOT EXISTS 'PARTIAL';

ALTER TABLE "FetchRun"
  ALTER COLUMN "userEmail" DROP NOT NULL,
  ADD COLUMN "discoveredCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "invalidCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "commitStartedAt" TIMESTAMP(3),
  ADD COLUMN "terminalAt" TIMESTAMP(3),
  ADD COLUMN "expectedBatchCount" INTEGER,
  ADD COLUMN "nextBatchIndex" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "executionAttemptId" UUID,
  ADD COLUMN "executionLeaseExpiresAt" TIMESTAMP(3),
  ADD CONSTRAINT "FetchRun_discoveredCount_check" CHECK ("discoveredCount" >= 0),
  ADD CONSTRAINT "FetchRun_invalidCount_check" CHECK ("invalidCount" >= 0),
  ADD CONSTRAINT "FetchRun_expectedBatchCount_check"
    CHECK ("expectedBatchCount" IS NULL OR "expectedBatchCount" > 0),
  ADD CONSTRAINT "FetchRun_nextBatchIndex_check" CHECK ("nextBatchIndex" >= 0),
  ADD CONSTRAINT "FetchRun_executionLease_pair_check"
    CHECK (
      ("executionAttemptId" IS NULL) =
      ("executionLeaseExpiresAt" IS NULL)
    );

CREATE TABLE "FetchRunCommitReceipt" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "fetchRunId" UUID NOT NULL,
  "batchKey" TEXT NOT NULL,
  "executionAttemptId" UUID NOT NULL,
  "batchIndex" INTEGER NOT NULL,
  "batchCount" INTEGER NOT NULL,
  "requestHash" TEXT NOT NULL,
  "itemCount" INTEGER NOT NULL,
  "importedCount" INTEGER NOT NULL,
  "invalidCount" INTEGER NOT NULL,
  "terminal" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FetchRunCommitReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FetchRunCommitReceipt_batchIndex_check" CHECK ("batchIndex" >= 0),
  CONSTRAINT "FetchRunCommitReceipt_batchCount_check" CHECK ("batchCount" > 0),
  CONSTRAINT "FetchRunCommitReceipt_batchRange_check"
    CHECK ("batchIndex" < "batchCount"),
  CONSTRAINT "FetchRunCommitReceipt_terminalIndex_check"
    CHECK (NOT "terminal" OR "batchIndex" = "batchCount" - 1),
  CONSTRAINT "FetchRunCommitReceipt_itemCount_check" CHECK ("itemCount" >= 0),
  CONSTRAINT "FetchRunCommitReceipt_importedCount_check" CHECK ("importedCount" >= 0),
  CONSTRAINT "FetchRunCommitReceipt_invalidCount_check" CHECK ("invalidCount" >= 0)
);

CREATE UNIQUE INDEX "FetchRunCommitReceipt_fetchRunId_batchKey_key"
  ON "FetchRunCommitReceipt"("fetchRunId", "batchKey");
CREATE UNIQUE INDEX "FetchRunCommitReceipt_fetchRunId_batchIndex_key"
  ON "FetchRunCommitReceipt"("fetchRunId", "batchIndex");
CREATE INDEX "FetchRunCommitReceipt_fetchRunId_createdAt_idx"
  ON "FetchRunCommitReceipt"("fetchRunId", "createdAt");

ALTER TABLE "FetchRunCommitReceipt"
  ADD CONSTRAINT "FetchRunCommitReceipt_fetchRunId_fkey"
  FOREIGN KEY ("fetchRunId") REFERENCES "FetchRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
