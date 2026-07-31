-- Expand the local Agent Runtime credential boundary and reconcile production
-- databases that applied an early version of the artifact-lifecycle migration.
--
-- The already-applied 20260726120000 migration is immutable. Some databases
-- received its earlier shape (URL/pathname uniqueness and no physical storage
-- identity), while a fresh database receives the complete shape now present in
-- the repository. Every reconciliation statement below is therefore additive
-- or idempotent.

BEGIN;

-- Fail instead of waiting indefinitely behind a busy production writer. The
-- transaction makes every reconciliation step atomic; Prisma does not wrap
-- PostgreSQL migration files in a transaction for us.
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

-- ---------------------------------------------------------------------------
-- AgentCredential v1
-- ---------------------------------------------------------------------------

-- This is the first migration that owns this name. A pre-existing table is an
-- unexpected hotfix or partial deploy and must fail the migration rather than
-- being silently accepted with a weaker shape.
CREATE TABLE "AgentCredential" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'Joblit Runner',
  "audience" TEXT NOT NULL DEFAULT 'joblit-agent',
  "version" INTEGER NOT NULL DEFAULT 1,
  -- Prisma models scalar lists as a nullable PostgreSQL array. The contract
  -- check below supplies the stronger non-null invariant without creating
  -- permanent schema-engine drift.
  "capabilities" TEXT[],
  "lastUsedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentCredential_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AgentCredential_token_hash_check"
    CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "AgentCredential_name_check"
    CHECK (btrim("name") <> ''),
  CONSTRAINT "AgentCredential_contract_check"
    CHECK (
      "audience" = 'joblit-agent'
      AND "version" = 1
      AND "capabilities" IS NOT NULL
      AND cardinality("capabilities") >= 1
      AND "capabilities" <@ ARRAY[
        'fit:drain',
        'tailoring:execute',
        'tailoring:control'
      ]::TEXT[]
    ),
  CONSTRAINT "AgentCredential_expiry_check"
    CHECK ("expiresAt" > "createdAt")
);

CREATE UNIQUE INDEX "AgentCredential_tokenHash_key"
  ON "AgentCredential"("tokenHash");

CREATE INDEX "AgentCredential_userId_revokedAt_idx"
  ON "AgentCredential"("userId", "revokedAt");

CREATE INDEX "AgentCredential_audience_version_revokedAt_idx"
  ON "AgentCredential"("audience", "version", "revokedAt");

-- ---------------------------------------------------------------------------
-- Fit batch exact-replay receipt
-- ---------------------------------------------------------------------------

-- Like AgentCredential, this table is introduced exactly here. Refuse a
-- pre-existing lookalike so exact-replay evidence can never use a weak schema.
CREATE TABLE "FitBatchImportReceipt" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "issueKey" CHAR(64) NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "settlement" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FitBatchImportReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FitBatchImportReceipt_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FitBatchImportReceipt_issue_key_check"
    CHECK ("issueKey" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "FitBatchImportReceipt_request_hash_check"
    CHECK ("requestHash" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "FitBatchImportReceipt_userId_issueKey_key"
  ON "FitBatchImportReceipt"("userId", "issueKey");

CREATE INDEX "FitBatchImportReceipt_userId_createdAt_idx"
  ON "FitBatchImportReceipt"("userId", "createdAt");

-- ---------------------------------------------------------------------------
-- ApplicationArtifact physical identity
-- ---------------------------------------------------------------------------

-- Freeze artifact writers while identities are backfilled and their unique
-- serialization keys are swapped. Without this lock, a row inserted between
-- the duplicate check and index creation could make the migration non-atomic.
LOCK TABLE "ApplicationArtifact" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "ApplicationArtifact"
  ADD COLUMN IF NOT EXISTS "storeHost" TEXT,
  ADD COLUMN IF NOT EXISTS "storageIdentity" TEXT,
  ADD COLUMN IF NOT EXISTS "provisionalIdentity" TEXT;

-- Decode URL pathnames for the one-time physical-identity backfill. Malformed
-- escapes preserve the encoded input rather than creating a partial identity.
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

WITH "identityCandidates" AS (
  SELECT
    artifact."id",
    btrim(artifact."url") AS "url",
    CASE
      WHEN btrim(artifact."url") ~* '^https?://[^/?#]+(/|$)'
      THEN lower(split_part(
        substring(
          btrim(artifact."url")
          FROM '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/?#]+)'
        ),
        ':',
        1
      ))
      ELSE NULL
    END AS "candidateStoreHost",
    CASE
      WHEN btrim(artifact."url") ~* '^https?://[^/?#]+(/|$)'
      THEN regexp_replace(
        pg_temp.joblit_percent_decode(
          regexp_replace(
            split_part(split_part(btrim(artifact."url"), '?', 1), '#', 1),
            '^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]+/*',
            '',
            'i'
          )
        ),
        '^/+',
        ''
      )
      ELSE NULL
    END AS "decodedPathname"
  FROM "ApplicationArtifact" AS artifact
  WHERE artifact."url" IS NOT NULL
    AND artifact."storageIdentity" IS NULL
),
"validatedIdentities" AS (
  SELECT
    "id",
    "url",
    "candidateStoreHost",
    "decodedPathname",
    (
      "candidateStoreHost" IS NOT NULL
      AND "candidateStoreHost" ~
        '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
      AND "decodedPathname" IS NOT NULL
      AND btrim("decodedPathname") <> ''
    ) AS "isCanonicalIdentity"
  FROM "identityCandidates"
)
UPDATE "ApplicationArtifact" AS artifact
SET
  "storeHost" = CASE
    WHEN identity."isCanonicalIdentity"
    THEN identity."candidateStoreHost"
    ELSE NULL
  END,
  "storageIdentity" = CASE
    WHEN identity."isCanonicalIdentity"
    THEN identity."candidateStoreHost" || '/' || identity."decodedPathname"
    ELSE 'legacy:' || identity."url"
  END,
  "provisionalIdentity" = NULL
FROM "validatedIdentities" AS identity
WHERE artifact."id" = identity."id";

-- Rows staged before an upload has returned do not know their store hostname.
-- Their logical pathname is the only safe serialization key for that window.
UPDATE "ApplicationArtifact"
SET "provisionalIdentity" = 'pending:' || "pathname"
WHERE "url" IS NULL
  AND "storeHost" IS NULL
  AND "storageIdentity" IS NULL
  AND "provisionalIdentity" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ApplicationArtifact"
    WHERE "url" IS NOT NULL
      AND "storageIdentity" IS NULL
  ) THEN
    RAISE EXCEPTION
      'ApplicationArtifact reconciliation left a stored URL without physical identity';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ApplicationArtifact"
    WHERE "storageIdentity" IS NOT NULL
    GROUP BY "storageIdentity"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'ApplicationArtifact reconciliation found duplicate physical identities';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ApplicationArtifact"
    WHERE "provisionalIdentity" IS NOT NULL
    GROUP BY "provisionalIdentity"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'ApplicationArtifact reconciliation found duplicate provisional identities';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "ApplicationArtifact_storageIdentity_key"
  ON "ApplicationArtifact"("storageIdentity");

CREATE UNIQUE INDEX IF NOT EXISTS "ApplicationArtifact_provisionalIdentity_key"
  ON "ApplicationArtifact"("provisionalIdentity");

-- This expand deployment deliberately leaves legacy pathname/url unique
-- indexes in place when they exist. The previous production binary may still
-- write through those keys until this deployment has proved healthy. A later
-- contract migration removes them after the new identity writers are live.
CREATE INDEX IF NOT EXISTS "ApplicationArtifact_pathname_idx"
  ON "ApplicationArtifact"("pathname");

CREATE INDEX IF NOT EXISTS "ApplicationArtifact_url_idx"
  ON "ApplicationArtifact"("url");

CREATE INDEX IF NOT EXISTS "ApplicationArtifact_staged_candidate_idx"
  ON "ApplicationArtifact"("stagedAt", "id")
  WHERE "state" = 'STAGED';

CREATE INDEX IF NOT EXISTS "ApplicationArtifact_deleting_lease_candidate_idx"
  ON "ApplicationArtifact"("claimLeaseExpiresAt", "id")
  WHERE "state" = 'DELETING';

CREATE INDEX IF NOT EXISTS "Application_resumePdfUrl_live_idx"
  ON "Application"("resumePdfUrl")
  WHERE "resumePdfUrl" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Application_coverPdfUrl_live_idx"
  ON "Application"("coverPdfUrl")
  WHERE "coverPdfUrl" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Application_resumeTexUrl_live_idx"
  ON "Application"("resumeTexUrl")
  WHERE "resumeTexUrl" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Application_coverTexUrl_live_idx"
  ON "Application"("coverTexUrl")
  WHERE "coverTexUrl" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ApplicationArtifact_identity_format_check'
      AND conrelid = '"ApplicationArtifact"'::regclass
  ) THEN
    ALTER TABLE "ApplicationArtifact"
      ADD CONSTRAINT "ApplicationArtifact_identity_format_check"
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
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ApplicationArtifact_storage_identity_check'
      AND conrelid = '"ApplicationArtifact"'::regclass
  ) THEN
    ALTER TABLE "ApplicationArtifact"
      ADD CONSTRAINT "ApplicationArtifact_storage_identity_check"
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
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ApplicationArtifact_provisional_identity_check'
      AND conrelid = '"ApplicationArtifact"'::regclass
  ) THEN
    ALTER TABLE "ApplicationArtifact"
      ADD CONSTRAINT "ApplicationArtifact_provisional_identity_check"
      CHECK (
        "provisionalIdentity" IS NULL
        OR (
          "url" IS NULL
          AND "storageIdentity" IS NULL
          AND "storeHost" IS NULL
          AND "provisionalIdentity" = 'pending:' || "pathname"
        )
      );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Resumable Blob inventory checkpoint
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "ApplicationArtifactInventoryCheckpoint" (
  "key" TEXT NOT NULL,
  "cursor" TEXT,
  "claimId" UUID,
  "claimLeaseExpiresAt" TIMESTAMP(3),
  "scanStartedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ApplicationArtifactInventoryCheckpoint_pkey"
    PRIMARY KEY ("key"),
  CONSTRAINT "ApplicationArtifactInventoryCheckpoint_claim_pair_check"
    CHECK (
      ("claimId" IS NULL AND "claimLeaseExpiresAt" IS NULL)
      OR
      ("claimId" IS NOT NULL AND "claimLeaseExpiresAt" IS NOT NULL)
    ),
  CONSTRAINT "ApplicationArtifactInventoryCheckpoint_cursor_scan_check"
    CHECK ("cursor" IS NULL OR "scanStartedAt" IS NOT NULL)
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

-- ---------------------------------------------------------------------------
-- Migration postconditions
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  artifact_table REGCLASS := to_regclass('"ApplicationArtifact"');
  agent_table REGCLASS := to_regclass('"AgentCredential"');
  fit_receipt_table REGCLASS := to_regclass('"FitBatchImportReceipt"');
  checkpoint_table REGCLASS :=
    to_regclass('"ApplicationArtifactInventoryCheckpoint"');
BEGIN
  IF agent_table IS NULL THEN
    RAISE EXCEPTION 'AgentCredential table was not created';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM pg_constraint
    WHERE conrelid = agent_table
      AND convalidated
      AND conname IN (
        'AgentCredential_pkey',
        'AgentCredential_userId_fkey',
        'AgentCredential_token_hash_check',
        'AgentCredential_name_check',
        'AgentCredential_contract_check',
        'AgentCredential_expiry_check'
      )
  ) <> 6 THEN
    RAISE EXCEPTION 'AgentCredential constraints do not match v1 contract';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indexrelid = to_regclass('"AgentCredential_tokenHash_key"')
      AND indrelid = agent_table
      AND indisunique
      AND indisvalid
      AND indnkeyatts = 1
      AND indpred IS NULL
      AND indexprs IS NULL
      AND pg_get_indexdef(indexrelid, 1, TRUE) = '"tokenHash"'
  ) THEN
    RAISE EXCEPTION 'AgentCredential token hash unique index is invalid';
  END IF;

  IF fit_receipt_table IS NULL OR (
    SELECT COUNT(*)
    FROM pg_constraint
    WHERE conrelid = fit_receipt_table
      AND convalidated
      AND conname IN (
        'FitBatchImportReceipt_pkey',
        'FitBatchImportReceipt_userId_fkey',
        'FitBatchImportReceipt_issue_key_check',
        'FitBatchImportReceipt_request_hash_check'
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'Fit batch receipt constraints are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indexrelid =
      to_regclass('"FitBatchImportReceipt_userId_issueKey_key"')
      AND indrelid = fit_receipt_table
      AND indisunique
      AND indisvalid
      AND indnkeyatts = 2
      AND indpred IS NULL
      AND indexprs IS NULL
      AND pg_get_indexdef(indexrelid, 1, TRUE) = '"userId"'
      AND pg_get_indexdef(indexrelid, 2, TRUE) = '"issueKey"'
  ) THEN
    RAISE EXCEPTION 'Fit batch receipt unique index is invalid';
  END IF;

  IF artifact_table IS NULL OR (
    SELECT COUNT(*)
    FROM pg_attribute
    WHERE attrelid = artifact_table
      AND NOT attisdropped
      AND attname IN (
        'storeHost',
        'storageIdentity',
        'provisionalIdentity'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'ApplicationArtifact identity columns are incomplete';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM pg_constraint
    WHERE conrelid = artifact_table
      AND convalidated
      AND conname IN (
        'ApplicationArtifact_identity_format_check',
        'ApplicationArtifact_storage_identity_check',
        'ApplicationArtifact_provisional_identity_check'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'ApplicationArtifact identity checks are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indexrelid =
      to_regclass('"ApplicationArtifact_storageIdentity_key"')
      AND indrelid = artifact_table
      AND indisunique
      AND indisvalid
      AND indnkeyatts = 1
      AND indpred IS NULL
      AND indexprs IS NULL
      AND pg_get_indexdef(indexrelid, 1, TRUE) = '"storageIdentity"'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indexrelid =
      to_regclass('"ApplicationArtifact_provisionalIdentity_key"')
      AND indrelid = artifact_table
      AND indisunique
      AND indisvalid
      AND indnkeyatts = 1
      AND indpred IS NULL
      AND indexprs IS NULL
      AND pg_get_indexdef(indexrelid, 1, TRUE) = '"provisionalIdentity"'
  ) THEN
    RAISE EXCEPTION 'ApplicationArtifact identity unique indexes are invalid';
  END IF;

  IF checkpoint_table IS NULL OR (
    SELECT COUNT(*)
    FROM pg_constraint
    WHERE conrelid = checkpoint_table
      AND convalidated
      AND conname IN (
        'ApplicationArtifactInventoryCheckpoint_pkey',
        'ApplicationArtifactInventoryCheckpoint_claim_pair_check',
        'ApplicationArtifactInventoryCheckpoint_cursor_scan_check'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'Artifact inventory checkpoint contract is incomplete';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM pg_attribute AS attribute
    JOIN (
      VALUES
        ('key', 'text', TRUE),
        ('cursor', 'text', FALSE),
        ('claimId', 'uuid', FALSE),
        ('claimLeaseExpiresAt', 'timestamp(3) without time zone', FALSE),
        ('scanStartedAt', 'timestamp(3) without time zone', FALSE),
        ('completedAt', 'timestamp(3) without time zone', FALSE),
        ('createdAt', 'timestamp(3) without time zone', TRUE),
        ('updatedAt', 'timestamp(3) without time zone', TRUE)
    ) AS expected("name", "type", "notNull")
      ON expected."name" = attribute.attname
    WHERE attribute.attrelid = checkpoint_table
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND format_type(attribute.atttypid, attribute.atttypmod)
        = expected."type"
      AND attribute.attnotnull = expected."notNull"
  ) <> 8 OR (
    SELECT COUNT(*)
    FROM pg_attribute
    WHERE attrelid = checkpoint_table
      AND attnum > 0
      AND NOT attisdropped
  ) <> 8 THEN
    RAISE EXCEPTION 'Artifact inventory checkpoint columns are invalid';
  END IF;

  IF (
    SELECT pg_get_expr(defaults.adbin, defaults.adrelid)
    FROM pg_attrdef AS defaults
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = defaults.adrelid
      AND attribute.attnum = defaults.adnum
    WHERE defaults.adrelid = checkpoint_table
      AND attribute.attname = 'createdAt'
  ) <> 'CURRENT_TIMESTAMP' OR EXISTS (
    SELECT 1
    FROM pg_attrdef AS defaults
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = defaults.adrelid
      AND attribute.attnum = defaults.adnum
    WHERE defaults.adrelid = checkpoint_table
      AND attribute.attname <> 'createdAt'
  ) THEN
    RAISE EXCEPTION 'Artifact inventory checkpoint defaults are invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "ApplicationArtifactInventoryCheckpoint"
    WHERE "key" = 'vercel-applications-v1'
  ) THEN
    RAISE EXCEPTION 'Artifact inventory checkpoint seed is missing';
  END IF;
END;
$$;

COMMIT;
