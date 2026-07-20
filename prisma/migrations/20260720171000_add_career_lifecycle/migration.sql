CREATE TYPE "ApplicationEventType" AS ENUM (
  'STATUS_CHANGED',
  'NOTE_ADDED',
  'INTERVIEW_PLANNED',
  'INTERVIEW_COMPLETED',
  'OFFER_RECORDED',
  'OFFER_UPDATED',
  'OFFER_DECIDED',
  'FOLLOW_UP_CREATED',
  'FOLLOW_UP_COMPLETED'
);

CREATE TYPE "ApplicationEventSource" AS ENUM ('USER', 'EXTENSION', 'SYSTEM', 'IMPORT');
CREATE TYPE "EvidenceKind" AS ENUM (
  'RESUME_PROFILE',
  'JOB_DESCRIPTION',
  'APPLICATION_DRAFT',
  'USER_CLAIM',
  'STAR_STORY',
  'INTERVIEW_NOTE',
  'OFFER'
);
CREATE TYPE "InterviewPlanStatus" AS ENUM ('DRAFT', 'READY', 'COMPLETED', 'ARCHIVED');
CREATE TYPE "OfferStatus" AS ENUM ('ACTIVE', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');
CREATE TYPE "FollowUpReminderType" AS ENUM (
  'APPLICATION_FOLLOW_UP',
  'INTERVIEW_THANK_YOU',
  'OFFER_DEADLINE',
  'CUSTOM'
);
CREATE TYPE "JobLivenessStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'UNCERTAIN');
CREATE TYPE "SourceHealthStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'DOWN', 'UNKNOWN');

ALTER TABLE "Application" ADD COLUMN "atsValidation" JSONB;
ALTER TABLE "Application" ADD COLUMN "reviewReport" JSONB;
ALTER TABLE "Job" ADD COLUMN "descriptionSimHash" CHAR(16);
ALTER TABLE "Job" ADD COLUMN "livenessStatus" "JobLivenessStatus" NOT NULL DEFAULT 'UNCERTAIN';
ALTER TABLE "Job" ADD COLUMN "livenessReason" TEXT;
ALTER TABLE "Job" ADD COLUMN "livenessCheckedAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN "lastSeenAt" TIMESTAMP(3);

CREATE TABLE "ApplicationEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "jobId" UUID,
  "applicationId" UUID,
  "companySnapshot" TEXT,
  "titleSnapshot" TEXT,
  "type" "ApplicationEventType" NOT NULL,
  "source" "ApplicationEventSource" NOT NULL DEFAULT 'USER',
  "fromStatus" "JobStatus",
  "toStatus" "JobStatus",
  "note" TEXT,
  "metadata" JSONB,
  "idempotencyKey" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApplicationEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvidenceSnapshot" (
  "id" TEXT NOT NULL,
  "userId" UUID NOT NULL,
  "applicationId" UUID,
  "jobId" UUID,
  "kind" "EvidenceKind" NOT NULL,
  "contentHash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "sourceLabel" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvidenceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClaimEvidence" (
  "id" TEXT NOT NULL,
  "userId" UUID NOT NULL,
  "applicationId" UUID NOT NULL,
  "evidenceSnapshotId" TEXT NOT NULL,
  "claimKey" TEXT NOT NULL,
  "claimText" TEXT NOT NULL,
  "claimHash" TEXT NOT NULL,
  "evidencePath" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClaimEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InterviewPlan" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "jobId" UUID NOT NULL,
  "round" INTEGER NOT NULL DEFAULT 1,
  "title" TEXT NOT NULL,
  "status" "InterviewPlanStatus" NOT NULL DEFAULT 'DRAFT',
  "scheduledAt" TIMESTAMP(3),
  "questions" JSONB NOT NULL,
  "starMappings" JSONB NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InterviewPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InterviewPlan_round_check" CHECK ("round" > 0)
);

CREATE TABLE "StarStory" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "situation" TEXT NOT NULL,
  "task" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "result" TEXT NOT NULL,
  "reflection" TEXT,
  "skills" JSONB NOT NULL,
  "tags" JSONB NOT NULL,
  "storyHash" TEXT NOT NULL,
  "sourceEvidenceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StarStory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Offer" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "jobId" UUID,
  "company" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'AUD',
  "baseSalaryAnnual" INTEGER,
  "bonusAnnual" INTEGER,
  "equityAnnual" INTEGER,
  "otherAnnual" INTEGER,
  "targetSalaryAnnual" INTEGER,
  "benefits" JSONB NOT NULL,
  "location" TEXT,
  "status" "OfferStatus" NOT NULL DEFAULT 'ACTIVE',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deadlineAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Offer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Offer_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "Offer_compensation_check" CHECK (
    COALESCE("baseSalaryAnnual", 0) >= 0 AND
    COALESCE("bonusAnnual", 0) >= 0 AND
    COALESCE("equityAnnual", 0) >= 0 AND
    COALESCE("otherAnnual", 0) >= 0 AND
    COALESCE("targetSalaryAnnual", 0) >= 0
  )
);

CREATE TABLE "FollowUpReminder" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "jobId" UUID,
  "applicationId" UUID,
  "type" "FollowUpReminderType" NOT NULL,
  "title" TEXT NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "note" TEXT,
  "completedAt" TIMESTAMP(3),
  "dismissedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FollowUpReminder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceHealth" (
  "source" TEXT NOT NULL,
  "status" "SourceHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "lastCheckedAt" TIMESTAMP(3),
  "lastReachableAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  "reason" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceHealth_pkey" PRIMARY KEY ("source"),
  CONSTRAINT "SourceHealth_failures_check" CHECK ("consecutiveFailures" >= 0)
);

CREATE TABLE "AtsBoardSource" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sourceId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "boardToken" TEXT NOT NULL,
  "company" TEXT NOT NULL,
  "region" TEXT,
  "careersUrl" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "lastRediscoveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AtsBoardSource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Job_userId_descriptionSimHash_idx"
  ON "Job"("userId", "descriptionSimHash");
CREATE INDEX "Job_userId_livenessStatus_idx"
  ON "Job"("userId", "livenessStatus");

CREATE UNIQUE INDEX "ApplicationEvent_userId_idempotencyKey_key"
  ON "ApplicationEvent"("userId", "idempotencyKey");
CREATE INDEX "ApplicationEvent_userId_occurredAt_idx"
  ON "ApplicationEvent"("userId", "occurredAt");
CREATE INDEX "ApplicationEvent_userId_jobId_occurredAt_idx"
  ON "ApplicationEvent"("userId", "jobId", "occurredAt");
CREATE INDEX "ApplicationEvent_applicationId_occurredAt_idx"
  ON "ApplicationEvent"("applicationId", "occurredAt");
CREATE INDEX "ApplicationEvent_userId_type_occurredAt_idx"
  ON "ApplicationEvent"("userId", "type", "occurredAt");

CREATE UNIQUE INDEX "EvidenceSnapshot_userId_contentHash_kind_key"
  ON "EvidenceSnapshot"("userId", "contentHash", "kind");
CREATE INDEX "EvidenceSnapshot_userId_createdAt_idx"
  ON "EvidenceSnapshot"("userId", "createdAt");
CREATE INDEX "EvidenceSnapshot_applicationId_kind_idx"
  ON "EvidenceSnapshot"("applicationId", "kind");
CREATE INDEX "EvidenceSnapshot_jobId_kind_idx"
  ON "EvidenceSnapshot"("jobId", "kind");

CREATE UNIQUE INDEX "ClaimEvidence_applicationId_claimHash_evidenceSnapshotId_key"
  ON "ClaimEvidence"("applicationId", "claimHash", "evidenceSnapshotId");
CREATE INDEX "ClaimEvidence_userId_applicationId_idx"
  ON "ClaimEvidence"("userId", "applicationId");
CREATE INDEX "ClaimEvidence_evidenceSnapshotId_idx"
  ON "ClaimEvidence"("evidenceSnapshotId");

CREATE UNIQUE INDEX "InterviewPlan_userId_jobId_round_key"
  ON "InterviewPlan"("userId", "jobId", "round");
CREATE INDEX "InterviewPlan_userId_status_scheduledAt_idx"
  ON "InterviewPlan"("userId", "status", "scheduledAt");
CREATE INDEX "InterviewPlan_userId_updatedAt_idx"
  ON "InterviewPlan"("userId", "updatedAt");

CREATE UNIQUE INDEX "StarStory_userId_storyHash_key" ON "StarStory"("userId", "storyHash");
CREATE INDEX "StarStory_userId_updatedAt_idx" ON "StarStory"("userId", "updatedAt");
CREATE INDEX "StarStory_sourceEvidenceId_idx" ON "StarStory"("sourceEvidenceId");

CREATE INDEX "Offer_userId_status_receivedAt_idx" ON "Offer"("userId", "status", "receivedAt");
CREATE INDEX "Offer_userId_deadlineAt_idx" ON "Offer"("userId", "deadlineAt");
CREATE INDEX "Offer_jobId_idx" ON "Offer"("jobId");

CREATE INDEX "FollowUpReminder_userId_dueAt_idx" ON "FollowUpReminder"("userId", "dueAt");
CREATE INDEX "FollowUpReminder_userId_completedAt_dismissedAt_dueAt_idx"
  ON "FollowUpReminder"("userId", "completedAt", "dismissedAt", "dueAt");
CREATE INDEX "FollowUpReminder_jobId_idx" ON "FollowUpReminder"("jobId");
CREATE INDEX "FollowUpReminder_applicationId_idx" ON "FollowUpReminder"("applicationId");

CREATE INDEX "SourceHealth_status_updatedAt_idx" ON "SourceHealth"("status", "updatedAt");
CREATE UNIQUE INDEX "AtsBoardSource_sourceId_key" ON "AtsBoardSource"("sourceId");
CREATE UNIQUE INDEX "AtsBoardSource_provider_boardToken_key"
  ON "AtsBoardSource"("provider", "boardToken");
CREATE INDEX "AtsBoardSource_enabled_provider_idx" ON "AtsBoardSource"("enabled", "provider");
CREATE INDEX "AtsBoardSource_company_region_idx" ON "AtsBoardSource"("company", "region");

ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EvidenceSnapshot" ADD CONSTRAINT "EvidenceSnapshot_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvidenceSnapshot" ADD CONSTRAINT "EvidenceSnapshot_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EvidenceSnapshot" ADD CONSTRAINT "EvidenceSnapshot_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ClaimEvidence" ADD CONSTRAINT "ClaimEvidence_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClaimEvidence" ADD CONSTRAINT "ClaimEvidence_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClaimEvidence" ADD CONSTRAINT "ClaimEvidence_evidenceSnapshotId_fkey"
  FOREIGN KEY ("evidenceSnapshotId") REFERENCES "EvidenceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InterviewPlan" ADD CONSTRAINT "InterviewPlan_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InterviewPlan" ADD CONSTRAINT "InterviewPlan_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StarStory" ADD CONSTRAINT "StarStory_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StarStory" ADD CONSTRAINT "StarStory_sourceEvidenceId_fkey"
  FOREIGN KEY ("sourceEvidenceId") REFERENCES "EvidenceSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Offer" ADD CONSTRAINT "Offer_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FollowUpReminder" ADD CONSTRAINT "FollowUpReminder_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUpReminder" ADD CONSTRAINT "FollowUpReminder_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUpReminder" ADD CONSTRAINT "FollowUpReminder_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed one immutable baseline event for existing jobs. This preserves their
-- current projection without inventing a historical transition time.
INSERT INTO "ApplicationEvent" (
  "id",
  "userId",
  "jobId",
  "companySnapshot",
  "titleSnapshot",
  "type",
  "source",
  "fromStatus",
  "toStatus",
  "metadata",
  "idempotencyKey",
  "occurredAt",
  "createdAt"
)
SELECT
  gen_random_uuid(),
  "userId",
  "id",
  "company",
  "title",
  'STATUS_CHANGED'::"ApplicationEventType",
  'IMPORT'::"ApplicationEventSource",
  NULL,
  "status",
  '{"baseline":true,"migration":"20260720171000"}'::jsonb,
  CONCAT('migration:career-baseline:', "id"),
  "updatedAt",
  CURRENT_TIMESTAMP
FROM "Job";
