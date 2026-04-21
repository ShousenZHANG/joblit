-- Drop match-score columns and index. The keyword-based job scoring
-- feature was removed in favor of a simpler status-only UX.
DROP INDEX IF EXISTS "Job_userId_matchScore_idx";

ALTER TABLE "Job" DROP COLUMN IF EXISTS "matchScore";
ALTER TABLE "Job" DROP COLUMN IF EXISTS "matchBreakdown";
ALTER TABLE "Job" DROP COLUMN IF EXISTS "scoredAt";
ALTER TABLE "Job" DROP COLUMN IF EXISTS "scoredProfileVersion";
