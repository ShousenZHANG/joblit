-- Posting legitimacy signal, computed deterministically at import time.
-- Nullable so rows imported before this existed stay valid: absent is honest,
-- backfilling a score for a URL we never evaluated would be a guess.
ALTER TABLE "Job" ADD COLUMN "postingRisk" INTEGER;
ALTER TABLE "Job" ADD COLUMN "postingRiskFlags" JSONB;

CREATE INDEX "Job_userId_postingRisk_idx" ON "Job"("userId", "postingRisk");
