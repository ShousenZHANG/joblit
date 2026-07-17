-- Add AI role-fit triage columns to Job. All nullable; no data rewrite.
ALTER TABLE "Job"
  ADD COLUMN "fitScore" INTEGER,
  ADD COLUMN "fitVerdict" TEXT,
  ADD COLUMN "fitEligibility" TEXT,
  ADD COLUMN "fitMatrix" JSONB,
  ADD COLUMN "fitSource" TEXT,
  ADD COLUMN "fitScoredAt" TIMESTAMP(3),
  ADD COLUMN "fitSnapshotHash" TEXT;

CREATE INDEX "Job_userId_fitScore_idx" ON "Job"("userId", "fitScore");
