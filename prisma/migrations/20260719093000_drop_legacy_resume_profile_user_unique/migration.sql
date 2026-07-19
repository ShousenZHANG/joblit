-- The original one-resume-per-user migration created a standalone unique
-- index. PostgreSQL `DROP CONSTRAINT` does not remove that index, so explicitly
-- drop it now that ResumeProfile supports multiple rows per user.
DROP INDEX IF EXISTS "ResumeProfile_userId_key";
