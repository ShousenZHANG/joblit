-- Retire AI fit scoring (ADR-0019).
--
-- The fit UI left the product across the July–August triage rounds; this
-- removes the writer-less backend that remained: the durable claim queue, the
-- import receipts, and the Job score projections. Job rows themselves are
-- untouched — only their fit columns go. postingRisk and the deterministic JD
-- requirements analysis are separate axes and keep their columns.
--
-- Order: children before parents (FitBatchClaimItem and FitBatchImportReceipt
-- both reference FitBatchClaim), enums after the tables that use them.

DROP TABLE IF EXISTS "FitBatchClaimItem";
DROP TABLE IF EXISTS "FitBatchImportReceipt";
DROP TABLE IF EXISTS "FitBatchClaim";

DROP TYPE IF EXISTS "FitBatchClaimItemOutcome";
DROP TYPE IF EXISTS "FitBatchClaimStatus";

DROP INDEX IF EXISTS "Job_userId_fitScore_idx";

ALTER TABLE "Job"
  DROP COLUMN IF EXISTS "fitScore",
  DROP COLUMN IF EXISTS "fitVerdict",
  DROP COLUMN IF EXISTS "fitEligibility",
  DROP COLUMN IF EXISTS "fitMatrix",
  DROP COLUMN IF EXISTS "fitSource",
  DROP COLUMN IF EXISTS "fitScoredAt",
  DROP COLUMN IF EXISTS "fitSnapshotHash";
