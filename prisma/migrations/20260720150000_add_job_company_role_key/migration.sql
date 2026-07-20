-- Soft duplicate-detection key. Intentionally a plain index and NOT a unique
-- constraint: two genuinely different openings at one company can normalize to
-- the same key, so this powers a "possible duplicate" hint only.
-- Nullable: rows without a company cannot be keyed, and older rows are left
-- alone rather than backfilled from data the importer never evaluated.
ALTER TABLE "Job" ADD COLUMN "companyRoleKey" TEXT;

CREATE INDEX "Job_userId_companyRoleKey_idx" ON "Job"("userId", "companyRoleKey");
