-- Contract the retired browser-extension credential boundary only after the
-- Agent Runtime expand deployment is healthy and all old instances have
-- drained. The artifact indexes below are the last compatibility objects for
-- writers that treated presentation pathnames and URLs as physical identity.

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

-- Acquire the target relations before inspecting their indexes. This removes
-- the precondition-to-drop race and also fails closed if either table is gone.
LOCK TABLE "ApplicationArtifact" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "ExtensionToken" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "AgentCredential" IN ACCESS SHARE MODE;

DO $$
DECLARE
  agent_table REGCLASS := to_regclass('"AgentCredential"');
  artifact_table REGCLASS := to_regclass('"ApplicationArtifact"');
  extension_table REGCLASS := to_regclass('"ExtensionToken"');
  legacy_pathname_index REGCLASS :=
    to_regclass('"ApplicationArtifact_pathname_key"');
  legacy_url_index REGCLASS :=
    to_regclass('"ApplicationArtifact_url_key"');
BEGIN
  IF agent_table IS NULL OR artifact_table IS NULL OR extension_table IS NULL THEN
    RAISE EXCEPTION
      'Agent runtime contract prerequisites are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indexrelid =
      to_regclass('"ApplicationArtifact_storageIdentity_key"')
      AND indrelid = artifact_table
      AND indisunique
      AND indisvalid
      AND indisready
      AND indislive
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
      AND indisready
      AND indislive
      AND indnkeyatts = 1
      AND indpred IS NULL
      AND indexprs IS NULL
      AND pg_get_indexdef(indexrelid, 1, TRUE) = '"provisionalIdentity"'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indexrelid = to_regclass('"ApplicationArtifact_pathname_idx"')
      AND indrelid = artifact_table
      AND NOT indisunique
      AND indisvalid
      AND indisready
      AND indislive
      AND indnkeyatts = 1
      AND indpred IS NULL
      AND indexprs IS NULL
      AND pg_get_indexdef(indexrelid, 1, TRUE) = 'pathname'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indexrelid = to_regclass('"ApplicationArtifact_url_idx"')
      AND indrelid = artifact_table
      AND NOT indisunique
      AND indisvalid
      AND indisready
      AND indislive
      AND indnkeyatts = 1
      AND indpred IS NULL
      AND indexprs IS NULL
      AND pg_get_indexdef(indexrelid, 1, TRUE) = 'url'
  ) THEN
    RAISE EXCEPTION
      'ApplicationArtifact replacement indexes are invalid';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM pg_constraint
    WHERE conrelid = artifact_table
      AND contype = 'c'
      AND convalidated
      AND conname IN (
        'ApplicationArtifact_identity_format_check',
        'ApplicationArtifact_storage_identity_check',
        'ApplicationArtifact_provisional_identity_check'
      )
  ) <> 3 THEN
    RAISE EXCEPTION
      'ApplicationArtifact identity checks are invalid';
  END IF;

  IF legacy_pathname_index IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indexrelid = legacy_pathname_index
      AND indrelid = artifact_table
      AND indisunique
      AND indisvalid
      AND indisready
      AND indislive
      AND indnkeyatts = 1
      AND indpred IS NULL
      AND indexprs IS NULL
      AND pg_get_indexdef(indexrelid, 1, TRUE) = 'pathname'
  ) THEN
    RAISE EXCEPTION
      'ApplicationArtifact legacy pathname index has an unexpected shape';
  END IF;

  IF legacy_url_index IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indexrelid = legacy_url_index
      AND indrelid = artifact_table
      AND indisunique
      AND indisvalid
      AND indisready
      AND indislive
      AND indnkeyatts = 1
      AND indpred IS NULL
      AND indexprs IS NULL
      AND pg_get_indexdef(indexrelid, 1, TRUE) = 'url'
  ) THEN
    RAISE EXCEPTION
      'ApplicationArtifact legacy URL index has an unexpected shape';
  END IF;
END
$$;

-- Deliberately omit CASCADE: an unexpected dependency must stop the contract
-- migration instead of being silently destroyed.
DROP TABLE "ExtensionToken";
DROP INDEX IF EXISTS "ApplicationArtifact_pathname_key";
DROP INDEX IF EXISTS "ApplicationArtifact_url_key";

DO $$
DECLARE
  agent_table REGCLASS := to_regclass('"AgentCredential"');
  artifact_table REGCLASS := to_regclass('"ApplicationArtifact"');
BEGIN
  IF agent_table IS NULL
    OR artifact_table IS NULL
    OR to_regclass('"ExtensionToken"') IS NOT NULL
    OR to_regclass('"ApplicationArtifact_pathname_key"') IS NOT NULL
    OR to_regclass('"ApplicationArtifact_url_key"') IS NOT NULL
    OR NOT EXISTS (
      SELECT 1
      FROM pg_index
      WHERE indexrelid =
        to_regclass('"ApplicationArtifact_storageIdentity_key"')
        AND indrelid = artifact_table
        AND indisunique
        AND indisvalid
        AND indisready
        AND indislive
        AND indnkeyatts = 1
        AND indpred IS NULL
        AND indexprs IS NULL
        AND pg_get_indexdef(indexrelid, 1, TRUE) = '"storageIdentity"'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_index
      WHERE indexrelid =
        to_regclass('"ApplicationArtifact_provisionalIdentity_key"')
        AND indrelid = artifact_table
        AND indisunique
        AND indisvalid
        AND indisready
        AND indislive
        AND indnkeyatts = 1
        AND indpred IS NULL
        AND indexprs IS NULL
        AND pg_get_indexdef(indexrelid, 1, TRUE) = '"provisionalIdentity"'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_index
      WHERE indexrelid = to_regclass('"ApplicationArtifact_pathname_idx"')
        AND indrelid = artifact_table
        AND NOT indisunique
        AND indisvalid
        AND indisready
        AND indislive
        AND indnkeyatts = 1
        AND indpred IS NULL
        AND indexprs IS NULL
        AND pg_get_indexdef(indexrelid, 1, TRUE) = 'pathname'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_index
      WHERE indexrelid = to_regclass('"ApplicationArtifact_url_idx"')
        AND indrelid = artifact_table
        AND NOT indisunique
        AND indisvalid
        AND indisready
        AND indislive
        AND indnkeyatts = 1
        AND indpred IS NULL
        AND indexprs IS NULL
        AND pg_get_indexdef(indexrelid, 1, TRUE) = 'url'
    )
    OR (
      SELECT COUNT(*)
      FROM pg_constraint
      WHERE conrelid = artifact_table
        AND contype = 'c'
        AND convalidated
        AND conname IN (
          'ApplicationArtifact_identity_format_check',
          'ApplicationArtifact_storage_identity_check',
          'ApplicationArtifact_provisional_identity_check'
        )
    ) <> 3
  THEN
    RAISE EXCEPTION 'Agent runtime contract migration did not converge';
  END IF;
END
$$;

COMMIT;
