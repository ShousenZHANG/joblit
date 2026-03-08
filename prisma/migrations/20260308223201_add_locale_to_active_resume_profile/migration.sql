-- AlterTable: Add locale column to ActiveResumeProfile with default "en-AU"
ALTER TABLE "ActiveResumeProfile" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en-AU';

-- DropIndex: Drop the old primary key (userId only)
ALTER TABLE "ActiveResumeProfile" DROP CONSTRAINT "ActiveResumeProfile_pkey";

-- CreateIndex: Create composite primary key (userId, locale)
ALTER TABLE "ActiveResumeProfile" ADD CONSTRAINT "ActiveResumeProfile_pkey" PRIMARY KEY ("userId", "locale");

-- CreateIndex: Add locale index to ResumeProfile for efficient locale-scoped queries
CREATE INDEX "ResumeProfile_userId_locale_updatedAt_idx" ON "ResumeProfile"("userId", "locale", "updatedAt");
