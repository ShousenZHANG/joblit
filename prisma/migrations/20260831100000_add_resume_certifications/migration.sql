-- Certifications were shipped end-to-end (editor, schema, both PDF templates)
-- on the assumption that ResumeProfile was a single JSON document that would
-- simply carry a new field. It is not: the profile is expanded columns, so the
-- write normalizer silently dropped the field and nothing persisted.
--
-- Additive and nullable: existing rows read as no certifications, which is what
-- they already effectively were.
ALTER TABLE "ResumeProfile" ADD COLUMN "certifications" JSONB;
