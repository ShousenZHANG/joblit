-- Expand-only repair for two historical Prisma/schema differences.
--
-- Fresh databases still have Application.locale and a database default on
-- ActiveResumeProfile.updatedAt. The long-lived production database does not.
-- Adding/restoring them before the Agent Runtime code deploy makes both paths
-- converge without invalidating the currently serving binary.

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE "Application"
  ADD COLUMN IF NOT EXISTS "locale" TEXT DEFAULT 'en-AU';

ALTER TABLE "Application"
  ALTER COLUMN "locale" SET DEFAULT 'en-AU';

-- PostgreSQL 11+ stores a constant ADD COLUMN default in table metadata, so
-- the missing-column production path does not rewrite or row-lock the table.
-- A validated check lets the final SET NOT NULL reuse proof instead of
-- scanning Application while the old deployment is still serving traffic.
ALTER TABLE "Application"
  ADD CONSTRAINT "Application_locale_not_null_convergence_check"
  CHECK ("locale" IS NOT NULL) NOT VALID;

ALTER TABLE "Application"
  VALIDATE CONSTRAINT "Application_locale_not_null_convergence_check";

ALTER TABLE "Application"
  ALTER COLUMN "locale" SET NOT NULL;

ALTER TABLE "Application"
  DROP CONSTRAINT "Application_locale_not_null_convergence_check";

ALTER TABLE "ActiveResumeProfile"
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

DO $$
DECLARE
  application_table REGCLASS := to_regclass('"Application"');
  active_profile_table REGCLASS := to_regclass('"ActiveResumeProfile"');
BEGIN
  IF application_table IS NULL OR active_profile_table IS NULL THEN
    RAISE EXCEPTION 'Schema convergence source tables are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = application_table
      AND attribute.attname = 'locale'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attnotnull
      AND format_type(attribute.atttypid, attribute.atttypmod) = 'text'
  ) OR (
    SELECT pg_get_expr(defaults.adbin, defaults.adrelid)
    FROM pg_attrdef AS defaults
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = defaults.adrelid
      AND attribute.attnum = defaults.adnum
    WHERE defaults.adrelid = application_table
      AND attribute.attname = 'locale'
  ) <> '''en-AU''::text' THEN
    RAISE EXCEPTION 'Application.locale did not converge';
  END IF;

  IF (
    SELECT pg_get_expr(defaults.adbin, defaults.adrelid)
    FROM pg_attrdef AS defaults
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = defaults.adrelid
      AND attribute.attnum = defaults.adnum
    WHERE defaults.adrelid = active_profile_table
      AND attribute.attname = 'updatedAt'
  ) <> 'CURRENT_TIMESTAMP' THEN
    RAISE EXCEPTION 'ActiveResumeProfile.updatedAt default did not converge';
  END IF;
END;
$$;

COMMIT;
