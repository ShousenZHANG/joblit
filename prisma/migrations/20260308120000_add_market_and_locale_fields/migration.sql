-- AlterTable: Add market column to Job
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "market" TEXT NOT NULL DEFAULT 'AU';

-- AlterTable: Add market column to FetchRun
ALTER TABLE "FetchRun" ADD COLUMN IF NOT EXISTS "market" TEXT NOT NULL DEFAULT 'AU';

-- AlterTable: Add locale column to ResumeProfile
ALTER TABLE "ResumeProfile" ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'en-AU';

-- AlterTable: Add locale column to Application
ALTER TABLE "Application" ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'en-AU';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Job_userId_market_createdAt_idx" ON "Job"("userId", "market", "createdAt");
