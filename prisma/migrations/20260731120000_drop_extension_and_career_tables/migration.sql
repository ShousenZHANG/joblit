-- Drop the tables left without writers after the browser extension was removed
-- (ADR-0014) and the Career workspace was retired (ADR-0006).
--
-- ADR-0006 deferred this because dropping stored user data needs an explicit
-- decision. That decision was taken against measured counts: InterviewPlan,
-- StarStory and Offer were empty, so the content those tables existed to
-- protect was never written. FieldMappingRule (13 rows) held autofill
-- selectors that cannot be used again, LocalAiSetting (1 row) held a loopback
-- endpoint, FollowUpReminder held one reminder, and FormSubmission (500 rows)
-- held ATS form values — personal data with no reader, kept only by inertia.
--
-- Every table here is user-scoped and cascade-deleted from "User", so no other
-- row depends on them. The three enums are dropped after their only tables.

DROP TABLE IF EXISTS "FormSubmission";
DROP TABLE IF EXISTS "FieldMappingRule";
DROP TABLE IF EXISTS "LocalAiSetting";
DROP TABLE IF EXISTS "FollowUpReminder";
DROP TABLE IF EXISTS "InterviewPlan";
DROP TABLE IF EXISTS "StarStory";
DROP TABLE IF EXISTS "Offer";

DROP TYPE IF EXISTS "FollowUpReminderType";
DROP TYPE IF EXISTS "InterviewPlanStatus";
DROP TYPE IF EXISTS "OfferStatus";

-- The extension is gone; a token issued today belongs to the Runner.
ALTER TABLE "ExtensionToken" ALTER COLUMN "name" SET DEFAULT 'Joblit Runner';
