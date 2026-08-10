-- Expand the TailoringRun protocol so batch proposal acceptance is durable
-- before independently retryable Resume/Cover publication.
BEGIN;
SET LOCAL lock_timeout = '15s';

ALTER TABLE "TailoringRun"
  ADD COLUMN "publicationRequiredTargetMask" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "publishedTargetMask" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "TailoringRun"
  DROP CONSTRAINT "TailoringRun_status_target_projection_check";

ALTER TABLE "TailoringRun"
  ADD CONSTRAINT "TailoringRun_publicationRequiredTargetMask_check"
    CHECK ("publicationRequiredTargetMask" BETWEEN 0 AND 3),
  ADD CONSTRAINT "TailoringRun_publicationTargetsSubset_check"
    CHECK (
      ("publicationRequiredTargetMask" & "requiredTargetMask") =
      "publicationRequiredTargetMask"
    ),
  ADD CONSTRAINT "TailoringRun_publishedTargetMask_check"
    CHECK ("publishedTargetMask" BETWEEN 0 AND 3),
  ADD CONSTRAINT "TailoringRun_publishedTargetsAccepted_check"
    CHECK (("publishedTargetMask" & "acceptedTargetMask") = "publishedTargetMask"),
  ADD CONSTRAINT "TailoringRun_publishedTargetsRequired_check"
    CHECK (
      ("publishedTargetMask" & "publicationRequiredTargetMask") =
      "publishedTargetMask"
    ),
  ADD CONSTRAINT "TailoringRun_status_target_projection_check"
    CHECK (
      (
        "status" = 'SUCCEEDED' AND
        "acceptedTargetMask" = "requiredTargetMask" AND
        "publishedTargetMask" = "publicationRequiredTargetMask"
      ) OR
      (
        "status" = 'PARTIAL' AND
        "acceptedTargetMask" > 0 AND
        (
          "acceptedTargetMask" < "requiredTargetMask" OR
          "publishedTargetMask" < "publicationRequiredTargetMask"
        )
      ) OR
      (
        "status" = 'RUNNING' AND
        (
          "acceptedTargetMask" < "requiredTargetMask" OR
          "publishedTargetMask" < "publicationRequiredTargetMask"
        )
      ) OR
      (
        "status" IN ('ISSUED', 'FAILED', 'CANCELLED') AND
        "acceptedTargetMask" = 0 AND
        "publishedTargetMask" = 0
      )
    );

ALTER TABLE "ApplicationBatchTask"
  DROP CONSTRAINT "ApplicationBatchTask_tailoringProtocolVersion_check",
  DROP CONSTRAINT "ApplicationBatchTask_tailoringCompletionProof_check";

ALTER TABLE "ApplicationBatchTask"
  ADD CONSTRAINT "ApplicationBatchTask_tailoringProtocolVersion_check"
    CHECK ("tailoringProtocolVersion" IN (0, 1, 2)),
  ADD CONSTRAINT "ApplicationBatchTask_tailoringCompletionProof_check"
    CHECK (
      (
        "tailoringProtocolVersion" = 0 AND
        "completionAttemptId" IS NULL
      ) OR
      (
        "tailoringProtocolVersion" IN (1, 2) AND
        (
          (
            "status" = 'SUCCEEDED' AND
            "executionAttemptId" IS NOT NULL AND
            "completionAttemptId" = "executionAttemptId"
          ) OR
          (
            "status" <> 'SUCCEEDED' AND
            "completionAttemptId" IS NULL
          )
        )
      )
    );

CREATE TABLE "TailoringRunPublicationReceipt" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "runId" UUID NOT NULL,
  "target" "TailoringRunTarget" NOT NULL,
  "executionAttemptId" UUID NOT NULL,
  "applicationId" UUID,
  "documentContentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TailoringRunPublicationReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TailoringRunPublicationReceipt_runId_target_key"
  ON "TailoringRunPublicationReceipt"("runId", "target");
CREATE INDEX "TailoringRunPublicationReceipt_applicationId_createdAt_idx"
  ON "TailoringRunPublicationReceipt"("applicationId", "createdAt");
CREATE INDEX "TailoringRunPublicationReceipt_executionAttemptId_idx"
  ON "TailoringRunPublicationReceipt"("executionAttemptId");

ALTER TABLE "TailoringRunPublicationReceipt"
  ADD CONSTRAINT "TailoringRunPublicationReceipt_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "TailoringRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "TailoringRunPublicationReceipt_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
