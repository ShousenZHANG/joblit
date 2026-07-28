-- Expand the Application aggregate with independently provable Resume and
-- Cover publication identities. All columns are nullable so pre-cutover rows
-- remain readable; without target-level proof they project conservatively as
-- Draft until explicitly republished.
ALTER TABLE "Application"
ADD COLUMN "resumeContentHash" TEXT,
ADD COLUMN "resumePublishedHash" TEXT,
ADD COLUMN "coverContentHash" TEXT,
ADD COLUMN "coverPublishedHash" TEXT,
ADD CONSTRAINT "Application_resumePublishedHash_requires_pdf"
  CHECK ("resumePublishedHash" IS NULL OR "resumePdfUrl" IS NOT NULL) NOT VALID,
ADD CONSTRAINT "Application_coverPublishedHash_requires_pdf"
  CHECK ("coverPublishedHash" IS NULL OR "coverPdfUrl" IS NOT NULL) NOT VALID;

-- NOT VALID keeps the expand migration from scanning and strongly locking the
-- existing Application table. PostgreSQL still enforces both checks for every
-- new or updated row. A later operational migration can VALIDATE them online.

-- Preserve which target version an immutable Tailoring Run receipt accepted.
-- Historical receipts remain valid with a NULL target hash.
ALTER TABLE "TailoringRunReceipt"
ADD COLUMN "documentContentHash" TEXT;
