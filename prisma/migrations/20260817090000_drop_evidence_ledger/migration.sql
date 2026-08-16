-- Retire the evidence ledger (ADR-0023).
--
-- The ledger existed to judge AI-generated content. It blocked on exactly two
-- things: an accepted AI-added bullet with no supporting evidence, and a
-- numeric claim whose digits appeared nowhere in the candidate's profile. AI
-- bullet generation is now retired, so the first rule has nothing left to
-- judge, and the second guards a single 350-character summary — which
-- `lib/server/ai/summaryLint.ts` now does deterministically at the import
-- boundary, without storing anything.
--
-- Application.reviewReport goes with them: it was a denormalised copy of the
-- review this ledger produced.
--
-- Dropped in dependency order: ClaimEvidence references EvidenceSnapshot with
-- ON DELETE RESTRICT, so the edge table goes first.

BEGIN;

-- A DROP TABLE needs ACCESS EXCLUSIVE. Without a timeout it queues behind any
-- long-running reader and then blocks every subsequent query on these tables
-- for the length of that queue; failing fast is the safer outcome for a deploy.
SET LOCAL lock_timeout = '5s';

DROP TABLE IF EXISTS "ClaimEvidence";
DROP TABLE IF EXISTS "EvidenceSnapshot";

DROP TYPE IF EXISTS "EvidenceKind";

ALTER TABLE "Application" DROP COLUMN IF EXISTS "reviewReport";

COMMIT;
