-- CreateTable
CREATE TABLE "FormSubmission" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "jobId" UUID,
    "pageUrl" TEXT NOT NULL,
    "pageDomain" TEXT NOT NULL,
    "atsProvider" TEXT,
    "formSignature" TEXT NOT NULL,
    "fieldValues" JSONB NOT NULL,
    "fieldMappings" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldMappingRule" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "fieldSelector" TEXT NOT NULL,
    "fieldLabel" TEXT,
    "atsProvider" TEXT,
    "pageDomain" TEXT,
    "profilePath" TEXT NOT NULL,
    "staticValue" TEXT,
    "source" TEXT NOT NULL DEFAULT 'user',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldMappingRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FormSubmission_userId_pageDomain_formSignature_idx" ON "FormSubmission"("userId", "pageDomain", "formSignature");
CREATE INDEX "FormSubmission_userId_submittedAt_idx" ON "FormSubmission"("userId", "submittedAt");
CREATE INDEX "FormSubmission_userId_atsProvider_idx" ON "FormSubmission"("userId", "atsProvider");

-- CreateIndex
CREATE INDEX "FieldMappingRule_userId_atsProvider_fieldLabel_idx" ON "FieldMappingRule"("userId", "atsProvider", "fieldLabel");
CREATE INDEX "FieldMappingRule_userId_pageDomain_idx" ON "FieldMappingRule"("userId", "pageDomain");
CREATE UNIQUE INDEX "FieldMappingRule_userId_fieldSelector_atsProvider_pageDomain_key" ON "FieldMappingRule"("userId", "fieldSelector", "atsProvider", "pageDomain");

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FieldMappingRule" ADD CONSTRAINT "FieldMappingRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
