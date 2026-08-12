-- Retire the local Runner, the Application Batch queue and the TailoringRun
-- receipt ledger (ADR-0022). Generation now enters only through the manual
-- copy/paste path, which never wrote any of these tables.
--
-- Dropped in dependency order: receipts reference runs, tasks reference
-- batches, and every one of them references User.
--
-- AgentCredential goes with them. It authenticated nothing but the Runner, and
-- dropping it permanently revokes every token ever minted — including several
-- that leaked in plaintext during development and were never confirmed
-- revoked. That is the point, not a side effect.

DROP TABLE IF EXISTS "TailoringRunPublicationReceipt";
DROP TABLE IF EXISTS "TailoringRunReceipt";
DROP TABLE IF EXISTS "TailoringRun";
DROP TABLE IF EXISTS "ApplicationBatchTask";
DROP TABLE IF EXISTS "ApplicationBatch";
DROP TABLE IF EXISTS "AgentCredential";

DROP TYPE IF EXISTS "TailoringRunTarget";
DROP TYPE IF EXISTS "TailoringRunStatus";
DROP TYPE IF EXISTS "TailoringRunDelivery";
DROP TYPE IF EXISTS "TailoringRunSource";
DROP TYPE IF EXISTS "ApplicationBatchTaskStatus";
DROP TYPE IF EXISTS "ApplicationBatchStatus";
DROP TYPE IF EXISTS "ApplicationBatchScope";
