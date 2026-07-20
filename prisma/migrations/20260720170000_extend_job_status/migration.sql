-- Extend the read-optimized Job.status projection before lifecycle tables use
-- the new values. Kept in a separate migration so PostgreSQL never needs to
-- consume a newly-added enum value in the same migration transaction.
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'INTERVIEW';
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'OFFER';
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'WITHDRAWN';
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'ACCEPTED';
