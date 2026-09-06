CREATE TABLE "LocalTailoringTask" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "jobId" UUID NOT NULL,
  "target" TEXT NOT NULL CHECK ("target" IN ('resume', 'cover')),
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'generating', 'publishing', 'repair', 'completed', 'failed', 'cancelled', 'expired')),
  "attempt" INTEGER NOT NULL DEFAULT 0 CHECK ("attempt" BETWEEN 0 AND 3),
  "capabilityHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "promptHash" TEXT NOT NULL,
  "resumeProfileId" UUID NOT NULL,
  "resumeSnapshotHash" TEXT NOT NULL,
  "jobSnapshotHash" TEXT NOT NULL,
  "profileUpdatedAt" TIMESTAMP(3) NOT NULL,
  "rulesHash" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "expectedTargetHash" TEXT NOT NULL,
  "result" JSONB,
  "error" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LocalTailoringTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LocalTailoringTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LocalTailoringTask_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "LocalTailoringTask_userId_jobId_target_createdAt_idx" ON "LocalTailoringTask"("userId", "jobId", "target", "createdAt");
CREATE INDEX "LocalTailoringTask_status_expiresAt_idx" ON "LocalTailoringTask"("status", "expiresAt");
CREATE UNIQUE INDEX "LocalTailoringTask_one_active_target" ON "LocalTailoringTask"("userId", "jobId", "target") WHERE "status" IN ('pending', 'generating', 'publishing', 'repair');
CREATE TABLE "LocalTailoringAttempt" (
  "taskId" UUID NOT NULL,
  "attempt" INTEGER NOT NULL CHECK ("attempt" BETWEEN 1 AND 3),
  "outputHash" TEXT NOT NULL,
  "claimId" UUID,
  "claimExpiresAt" TIMESTAMP(3),
  "response" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LocalTailoringAttempt_pkey" PRIMARY KEY ("taskId", "attempt"),
  CONSTRAINT "LocalTailoringAttempt_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "LocalTailoringTask"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LocalTailoringAttempt_claim_pair" CHECK (("claimId" IS NULL) = ("claimExpiresAt" IS NULL))
);
