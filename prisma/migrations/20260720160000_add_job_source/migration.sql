-- Ingestion provenance for each job row. Nullable so existing rows stay valid;
-- backfilling them would be a guess, and "unknown" is the honest value.
-- This column is what per-source health tracking and source filtering build on.
ALTER TABLE "Job" ADD COLUMN "source" TEXT;

CREATE INDEX "Job_userId_source_idx" ON "Job"("userId", "source");
