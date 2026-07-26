-- CreateEnum
CREATE TYPE "ApplicationArtifactTarget" AS ENUM (
  'RESUME_PDF',
  'COVER_PDF',
  'RESUME_TEX',
  'COVER_TEX'
);

-- CreateEnum
CREATE TYPE "ApplicationArtifactState" AS ENUM (
  'STAGED',
  'REFERENCED',
  'DELETE_PENDING',
  'DELETING',
  'DELETED'
);

-- CreateTable
-- This is a lifecycle ledger, not an owned child relation. The scalar identity
-- snapshots intentionally have no foreign keys so deletion evidence survives
-- removal of the User, Job, or Application row.
CREATE TABLE "ApplicationArtifact" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "jobId" UUID,
  "applicationId" UUID,
  "target" "ApplicationArtifactTarget" NOT NULL,
  "pathname" TEXT NOT NULL,
  "url" TEXT,
  "storeHost" TEXT,
  "storageIdentity" TEXT,
  "provisionalIdentity" TEXT,
  "contentVersion" TEXT,
  "contentHash" TEXT,
  "state" "ApplicationArtifactState" NOT NULL DEFAULT 'STAGED',
  "deleteAfter" TIMESTAMP(3),
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "claimId" UUID,
  "claimLeaseExpiresAt" TIMESTAMP(3),
  "lastError" TEXT,
  "stagedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "referencedAt" TIMESTAMP(3),
  "deleteRequestedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "inventorySeenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ApplicationArtifact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApplicationArtifact_retryCount_check"
    CHECK ("retryCount" >= 0),
  CONSTRAINT "ApplicationArtifact_identity_format_check"
    CHECK (
      btrim("pathname") <> ''
      AND (
        "contentHash" IS NULL
        OR "contentHash" ~ '^[a-f0-9]{64}$'
      )
      AND (
        "storeHost" IS NULL
        OR (
          "storeHost" = lower("storeHost")
          AND "storeHost" = btrim("storeHost")
          AND left("storageIdentity", char_length("storeHost") + 1)
            = "storeHost" || '/'
        )
      )
    ),
  CONSTRAINT "ApplicationArtifact_claim_pair_check"
    CHECK (
      ("claimId" IS NULL AND "claimLeaseExpiresAt" IS NULL)
      OR
      ("claimId" IS NOT NULL AND "claimLeaseExpiresAt" IS NOT NULL)
    ),
  CONSTRAINT "ApplicationArtifact_storage_identity_check"
    CHECK (
      (
        "url" IS NULL
        AND "storeHost" IS NULL
        AND "storageIdentity" IS NULL
      )
      OR
      (
        "url" IS NOT NULL
        AND "storageIdentity" IS NOT NULL
        AND btrim("storageIdentity") <> ''
        AND (
          (
            "storeHost" IS NOT NULL
            AND btrim("storeHost") <> ''
          )
          OR
          (
            "storeHost" IS NULL
            AND "storageIdentity" LIKE 'legacy:%'
          )
        )
      )
    ),
  CONSTRAINT "ApplicationArtifact_provisional_identity_check"
    CHECK (
      "provisionalIdentity" IS NULL
      OR (
        "url" IS NULL
        AND "storageIdentity" IS NULL
        AND "storeHost" IS NULL
        AND "provisionalIdentity" = 'pending:' || "pathname"
      )
    ),
  CONSTRAINT "ApplicationArtifact_state_projection_check"
    CHECK (
      (
        "state" = 'STAGED'
        AND "referencedAt" IS NULL
        AND "deleteAfter" IS NULL
        AND "nextAttemptAt" IS NULL
        AND "claimId" IS NULL
        AND "claimLeaseExpiresAt" IS NULL
        AND "lastError" IS NULL
        AND "deleteRequestedAt" IS NULL
        AND "deletedAt" IS NULL
        AND "retryCount" = 0
      )
      OR
      (
        "state" = 'REFERENCED'
        AND "applicationId" IS NOT NULL
        AND "url" IS NOT NULL
        AND "referencedAt" IS NOT NULL
        AND "deleteAfter" IS NULL
        AND "nextAttemptAt" IS NULL
        AND "claimId" IS NULL
        AND "claimLeaseExpiresAt" IS NULL
        AND "lastError" IS NULL
        AND "deleteRequestedAt" IS NULL
        AND "deletedAt" IS NULL
        AND "retryCount" = 0
      )
      OR
      (
        "state" = 'DELETE_PENDING'
        AND "deleteAfter" IS NOT NULL
        AND "deleteRequestedAt" IS NOT NULL
        AND "claimId" IS NULL
        AND "claimLeaseExpiresAt" IS NULL
        AND "deletedAt" IS NULL
      )
      OR
      (
        "state" = 'DELETING'
        AND "deleteAfter" IS NOT NULL
        AND "deleteRequestedAt" IS NOT NULL
        AND "claimId" IS NOT NULL
        AND "claimLeaseExpiresAt" IS NOT NULL
        AND "nextAttemptAt" IS NULL
        AND "lastError" IS NULL
        AND "deletedAt" IS NULL
      )
      OR
      (
        "state" = 'DELETED'
        AND "deletedAt" IS NOT NULL
        AND "deleteAfter" IS NULL
        AND "nextAttemptAt" IS NULL
        AND "claimId" IS NULL
        AND "claimLeaseExpiresAt" IS NULL
        AND "lastError" IS NULL
      )
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationArtifact_storageIdentity_key"
  ON "ApplicationArtifact"("storageIdentity");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationArtifact_provisionalIdentity_key"
  ON "ApplicationArtifact"("provisionalIdentity");

-- CreateIndex
CREATE INDEX "ApplicationArtifact_state_nextAttemptAt_idx"
  ON "ApplicationArtifact"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ApplicationArtifact_state_deleteAfter_idx"
  ON "ApplicationArtifact"("state", "deleteAfter");

-- CreateIndex
CREATE INDEX "ApplicationArtifact_userId_jobId_idx"
  ON "ApplicationArtifact"("userId", "jobId");

-- CreateIndex
CREATE INDEX "ApplicationArtifact_applicationId_idx"
  ON "ApplicationArtifact"("applicationId");

-- CreateIndex
CREATE INDEX "ApplicationArtifact_pathname_idx"
  ON "ApplicationArtifact"("pathname");

-- CreateIndex
CREATE INDEX "ApplicationArtifact_url_idx"
  ON "ApplicationArtifact"("url");

-- Exact fast paths for the mandatory live-pointer safety check.
CREATE INDEX "Application_resumePdfUrl_live_idx"
  ON "Application"("resumePdfUrl")
  WHERE "resumePdfUrl" IS NOT NULL;

CREATE INDEX "Application_coverPdfUrl_live_idx"
  ON "Application"("coverPdfUrl")
  WHERE "coverPdfUrl" IS NOT NULL;

CREATE INDEX "Application_resumeTexUrl_live_idx"
  ON "Application"("resumeTexUrl")
  WHERE "resumeTexUrl" IS NOT NULL;

CREATE INDEX "Application_coverTexUrl_live_idx"
  ON "Application"("coverTexUrl")
  WHERE "coverTexUrl" IS NOT NULL;

-- Candidate scans stay bounded to the state-specific working sets.
CREATE INDEX "ApplicationArtifact_staged_candidate_idx"
  ON "ApplicationArtifact"("stagedAt", "id")
  WHERE "state" = 'STAGED';

CREATE INDEX "ApplicationArtifact_deleting_lease_candidate_idx"
  ON "ApplicationArtifact"("claimLeaseExpiresAt", "id")
  WHERE "state" = 'DELETING';

-- CreateTable
CREATE TABLE "ApplicationArtifactInventoryCheckpoint" (
  "key" TEXT NOT NULL,
  "cursor" TEXT,
  "claimId" UUID,
  "claimLeaseExpiresAt" TIMESTAMP(3),
  "scanStartedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ApplicationArtifactInventoryCheckpoint_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "ApplicationArtifactInventoryCheckpoint_claim_pair_check"
    CHECK (
      ("claimId" IS NULL AND "claimLeaseExpiresAt" IS NULL)
      OR
      ("claimId" IS NOT NULL AND "claimLeaseExpiresAt" IS NOT NULL)
    ),
  CONSTRAINT "ApplicationArtifactInventoryCheckpoint_cursor_scan_check"
    CHECK (
      "cursor" IS NULL OR "scanStartedAt" IS NOT NULL
    )
);

INSERT INTO "ApplicationArtifactInventoryCheckpoint" (
  "key",
  "createdAt",
  "updatedAt"
) VALUES (
  'vercel-applications-v1',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
) ON CONFLICT DO NOTHING;

-- Decode URL pathnames for the one-time physical-identity backfill. The helper
-- lives only for this migration session. Like the runtime URL canonicalizer,
-- malformed/truncated escapes and invalid UTF-8 preserve the original encoded
-- pathname instead of partially decoding it.
CREATE OR REPLACE FUNCTION pg_temp.joblit_percent_decode(value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  index INTEGER := 1;
  output BYTEA := ''::BYTEA;
  pair TEXT;
BEGIN
  WHILE index <= char_length(value) LOOP
    IF substr(value, index, 1) = '%' THEN
      IF index + 2 > char_length(value) THEN
        RETURN value;
      END IF;
      pair := substr(value, index + 1, 2);
      IF pair !~ '^[0-9A-Fa-f]{2}$' THEN
        RETURN value;
      END IF;
      output := output || decode(pair, 'hex');
      index := index + 3;
      CONTINUE;
    END IF;
    output := output || convert_to(substr(value, index, 1), 'UTF8');
    index := index + 1;
  END LOOP;
  RETURN convert_from(output, 'UTF8');
EXCEPTION
  WHEN character_not_in_repertoire OR untranslatable_character THEN
    RETURN value;
END;
$$;

-- Backfill the four current Application artifact pointers by physical storage
-- identity: lower(store hostname) + decoded pathname. Base/download aliases
-- (query or fragment only) converge, while identical pathnames in two stores
-- remain separate. DISTINCT ON and ON CONFLICT keep this expand migration safe
-- when multiple Applications currently reference one physical object.
WITH "legacyUrls" AS (
  SELECT
    application."id" AS "applicationId",
    application."userId",
    application."jobId",
    application."updatedAt" AS "applicationUpdatedAt",
    artifact."target",
    artifact."url",
    artifact."targetOrder"
  FROM "Application" AS application
  CROSS JOIN LATERAL (
    VALUES
      ('RESUME_PDF'::"ApplicationArtifactTarget", application."resumePdfUrl", 1),
      ('COVER_PDF'::"ApplicationArtifactTarget", application."coverPdfUrl", 2),
      ('RESUME_TEX'::"ApplicationArtifactTarget", application."resumeTexUrl", 3),
      ('COVER_TEX'::"ApplicationArtifactTarget", application."coverTexUrl", 4)
  ) AS artifact("target", "url", "targetOrder")
  WHERE artifact."url" IS NOT NULL
    AND btrim(artifact."url") <> ''
),
"identityCandidates" AS (
  SELECT
    "applicationId",
    "userId",
    "jobId",
    "target",
    btrim("url") AS "url",
    CASE
      WHEN btrim("url") ~* '^https?://[^/?#]+(/|$)'
      THEN lower(split_part(
        substring(btrim("url") from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/?#]+)'),
        ':',
        1
      ))
      ELSE NULL
    END AS "candidateStoreHost",
    CASE
      WHEN btrim("url") ~* '^https?://[^/?#]+(/|$)'
      THEN regexp_replace(
        pg_temp.joblit_percent_decode(
          regexp_replace(
            split_part(split_part(btrim("url"), '?', 1), '#', 1),
            '^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]+/*',
            '',
            'i'
          )
        ),
        '^/+',
        ''
      )
      ELSE NULL
    END AS "decodedPathname",
    "applicationUpdatedAt",
    "targetOrder"
  FROM "legacyUrls"
),
"validatedIdentities" AS (
  SELECT
    "applicationId",
    "userId",
    "jobId",
    "target",
    "url",
    "candidateStoreHost",
    "decodedPathname",
    (
      "candidateStoreHost" IS NOT NULL
      AND "candidateStoreHost" ~
        '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
      AND "decodedPathname" IS NOT NULL
      AND btrim("decodedPathname") <> ''
    ) AS "isCanonicalIdentity",
    "applicationUpdatedAt",
    "targetOrder"
  FROM "identityCandidates"
),
"canonicalIdentities" AS (
  SELECT
    "applicationId",
    "userId",
    "jobId",
    "target",
    "url",
    CASE
      WHEN "isCanonicalIdentity"
      THEN "candidateStoreHost"
      ELSE NULL
    END AS "storeHost",
    "decodedPathname",
    CASE
      WHEN "isCanonicalIdentity"
      THEN "candidateStoreHost" || '/' || "decodedPathname"
      ELSE 'legacy:' || "url"
    END AS "storageIdentity",
    "applicationUpdatedAt",
    "targetOrder"
  FROM "validatedIdentities"
),
"deduplicatedIdentities" AS (
  SELECT DISTINCT ON ("storageIdentity")
    "applicationId",
    "userId",
    "jobId",
    "target",
    "url",
    "storeHost",
    "decodedPathname",
    "storageIdentity"
  FROM "canonicalIdentities"
  ORDER BY
    "storageIdentity",
    "applicationUpdatedAt" DESC,
    "applicationId",
    "targetOrder"
),
"safeRows" AS (
  SELECT
    "applicationId",
    "userId",
    "jobId",
    "target",
    "url",
    "storeHost",
    "storageIdentity",
    CASE
      WHEN "decodedPathname" LIKE 'applications/%'
      THEN "decodedPathname"
      ELSE 'legacy/' || md5("storageIdentity")
    END AS "pathname"
  FROM "deduplicatedIdentities"
)
INSERT INTO "ApplicationArtifact" (
  "id",
  "userId",
  "jobId",
  "applicationId",
  "target",
  "pathname",
  "url",
  "storeHost",
  "storageIdentity",
  "state",
  "stagedAt",
  "referencedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  "userId",
  "jobId",
  "applicationId",
  "target",
  "pathname",
  "url",
  "storeHost",
  "storageIdentity",
  'REFERENCED'::"ApplicationArtifactState",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "safeRows"
ON CONFLICT DO NOTHING;
