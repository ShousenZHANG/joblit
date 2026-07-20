-- Collapse Job.status onto the three states Joblit actually offers (ADR-0007).
--
-- Job.status is a read-optimized projection; ApplicationEvent is the source of
-- truth for history. Collapsing the projection therefore loses no information:
-- a job that reached INTERVIEW still has its STATUS_CHANGED events, with
-- fromStatus/toStatus recorded verbatim.
--
-- INTERVIEW, OFFER and ACCEPTED all mean the application is live -> APPLIED.
-- WITHDRAWN means the user is not pursuing it -> REJECTED.
--
-- The enum keeps all seven values. ApplicationEvent rows reference the retired
-- ones and must stay readable, and dropping an enum value would rewrite that
-- history.
UPDATE "Job"
SET "status" = 'APPLIED'
WHERE "status" IN ('INTERVIEW', 'OFFER', 'ACCEPTED');

UPDATE "Job"
SET "status" = 'REJECTED'
WHERE "status" = 'WITHDRAWN';
