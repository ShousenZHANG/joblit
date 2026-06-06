-- Add source-provided fields that were previously dropped: salary label,
-- work arrangement (Remote/Hybrid/On-site), and the listing date.
ALTER TABLE "Job" ADD COLUMN "salary" TEXT;
ALTER TABLE "Job" ADD COLUMN "workArrangement" TEXT;
ALTER TABLE "Job" ADD COLUMN "listingDate" TIMESTAMP(3);
