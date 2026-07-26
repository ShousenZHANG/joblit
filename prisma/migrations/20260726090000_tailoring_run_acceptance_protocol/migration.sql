CREATE TYPE "TailoringRunSource" AS ENUM (
  'MANUAL_IMPORT',
  'LOCAL_AI',
  'CODEX_BATCH',
  'SERVER_BATCH'
);

CREATE TYPE "TailoringRunDelivery" AS ENUM (
  'DRAFT',
  'FINAL'
);

CREATE TYPE "TailoringRunStatus" AS ENUM (
  'ISSUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'PARTIAL'
);

CREATE TYPE "TailoringRunTarget" AS ENUM (
  'RESUME',
  'COVER'
);

ALTER TABLE "ApplicationBatchTask"
  ADD COLUMN "executionAttemptId" UUID,
  ADD COLUMN "executionLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "tailoringProtocolVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "completionAttemptId" UUID,
  ADD CONSTRAINT "ApplicationBatchTask_executionLease_pair_check"
    CHECK (
      "executionLeaseExpiresAt" IS NULL OR
      "executionAttemptId" IS NOT NULL
    ),
  ADD CONSTRAINT "ApplicationBatchTask_tailoringProtocolVersion_check"
    CHECK ("tailoringProtocolVersion" IN (0, 1)),
  ADD CONSTRAINT "ApplicationBatchTask_tailoringCompletionProof_check"
    CHECK (
      (
        "tailoringProtocolVersion" = 0 AND
        "completionAttemptId" IS NULL
      ) OR
      (
        "tailoringProtocolVersion" = 1 AND
        (
          (
            "status" = 'SUCCEEDED' AND
            "executionAttemptId" IS NOT NULL AND
            "completionAttemptId" = "executionAttemptId"
          ) OR
          (
            "status" <> 'SUCCEEDED' AND
            "completionAttemptId" IS NULL
          )
        )
      )
    );

CREATE TABLE "TailoringRun" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "jobId" UUID NOT NULL,
  "resumeProfileId" UUID,
  "applicationBatchTaskId" UUID,
  "applicationId" UUID,
  "source" "TailoringRunSource" NOT NULL,
  "delivery" "TailoringRunDelivery" NOT NULL,
  "status" "TailoringRunStatus" NOT NULL DEFAULT 'ISSUED',
  "requiredTargetMask" INTEGER NOT NULL,
  "acceptedTargetMask" INTEGER NOT NULL DEFAULT 0,
  "issueKey" TEXT NOT NULL,
  "issueHash" TEXT NOT NULL,
  "promptReceipts" JSONB NOT NULL,
  "resumeSnapshotHash" TEXT NOT NULL,
  "jobSnapshotHash" TEXT NOT NULL,
  "executionAttemptId" UUID,
  "executionLeaseExpiresAt" TIMESTAMP(3),
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "terminalAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TailoringRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TailoringRun_requiredTargetMask_check"
    CHECK ("requiredTargetMask" BETWEEN 1 AND 3),
  CONSTRAINT "TailoringRun_acceptedTargetMask_check"
    CHECK ("acceptedTargetMask" BETWEEN 0 AND 3),
  CONSTRAINT "TailoringRun_acceptedTargetsSubset_check"
    CHECK (
      ("acceptedTargetMask" & "requiredTargetMask") =
      "acceptedTargetMask"
    ),
  CONSTRAINT "TailoringRun_attempt_check"
    CHECK ("attempt" >= 0),
  CONSTRAINT "TailoringRun_status_timestamp_check"
    CHECK (
      ("status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'PARTIAL')) =
      ("terminalAt" IS NOT NULL)
    ),
  CONSTRAINT "TailoringRun_status_target_projection_check"
    CHECK (
      ("status" = 'SUCCEEDED' AND
        "acceptedTargetMask" = "requiredTargetMask") OR
      ("status" = 'PARTIAL' AND
        "acceptedTargetMask" > 0 AND
        "acceptedTargetMask" < "requiredTargetMask") OR
      ("status" = 'RUNNING' AND
        "acceptedTargetMask" < "requiredTargetMask") OR
      ("status" IN ('ISSUED', 'FAILED', 'CANCELLED') AND
        "acceptedTargetMask" = 0)
    ),
  CONSTRAINT "TailoringRun_running_attempt_check"
    CHECK (
      "status" <> 'RUNNING' OR
      "executionAttemptId" IS NOT NULL
    ),
  CONSTRAINT "TailoringRun_executionLease_pair_check"
    CHECK (
      "executionLeaseExpiresAt" IS NULL OR
      "executionAttemptId" IS NOT NULL
    )
);

CREATE TABLE "TailoringRunReceipt" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "runId" UUID NOT NULL,
  "target" "TailoringRunTarget" NOT NULL,
  "executionAttemptId" UUID NOT NULL,
  "requestHash" TEXT NOT NULL,
  "applicationId" UUID,
  "aiContentHash" TEXT NOT NULL,
  "delivery" "TailoringRunDelivery" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TailoringRunReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TailoringRun_userId_issueKey_key"
  ON "TailoringRun"("userId", "issueKey");
CREATE UNIQUE INDEX "TailoringRun_applicationBatchTaskId_key"
  ON "TailoringRun"("applicationBatchTaskId");
CREATE INDEX "TailoringRun_userId_status_updatedAt_idx"
  ON "TailoringRun"("userId", "status", "updatedAt");
CREATE INDEX "TailoringRun_jobId_status_createdAt_idx"
  ON "TailoringRun"("jobId", "status", "createdAt");
CREATE INDEX "TailoringRun_resumeProfileId_idx"
  ON "TailoringRun"("resumeProfileId");
CREATE INDEX "TailoringRun_applicationId_createdAt_idx"
  ON "TailoringRun"("applicationId", "createdAt");
CREATE INDEX "TailoringRun_executionAttemptId_idx"
  ON "TailoringRun"("executionAttemptId");

CREATE UNIQUE INDEX "TailoringRunReceipt_runId_target_key"
  ON "TailoringRunReceipt"("runId", "target");
CREATE INDEX "TailoringRunReceipt_applicationId_createdAt_idx"
  ON "TailoringRunReceipt"("applicationId", "createdAt");
CREATE INDEX "TailoringRunReceipt_executionAttemptId_idx"
  ON "TailoringRunReceipt"("executionAttemptId");

CREATE INDEX "ApplicationBatchTask_executionAttemptId_idx"
  ON "ApplicationBatchTask"("executionAttemptId");
CREATE INDEX "ApplicationBatchTask_completionAttemptId_idx"
  ON "ApplicationBatchTask"("completionAttemptId");

ALTER TABLE "TailoringRun"
  ADD CONSTRAINT "TailoringRun_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "TailoringRun_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "TailoringRun_resumeProfileId_fkey"
  FOREIGN KEY ("resumeProfileId") REFERENCES "ResumeProfile"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "TailoringRun_applicationBatchTaskId_fkey"
  FOREIGN KEY ("applicationBatchTaskId") REFERENCES "ApplicationBatchTask"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "TailoringRun_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TailoringRunReceipt"
  ADD CONSTRAINT "TailoringRunReceipt_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "TailoringRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "TailoringRunReceipt_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
