import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { canonicalizeJobUrl } from "@/lib/shared/canonicalizeJobUrl";

// Canonical import-item schema, shared by every ingestion path (the Python
// fetcher via /api/admin/import, and the browser extension via
// /api/ext/jobs/import). Accepts both python snake_case and web camelCase
// field names so a single schema serves both producers.
export const ImportJobItemSchema = z
  .object({
    job_url: z.string().url().optional(),
    jobUrl: z.string().url().optional(),
    title: z.string().min(1),
    company: z.string().optional().nullable(),
    location: z.string().optional().nullable(),
    job_type: z.string().optional().nullable(),
    jobType: z.string().optional().nullable(),
    job_level: z.string().optional().nullable(),
    jobLevel: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    salary: z.string().optional().nullable(),
    work_arrangement: z.string().optional().nullable(),
    workArrangement: z.string().optional().nullable(),
    listing_date: z.string().optional().nullable(),
    listingDate: z.string().optional().nullable(),
    market: z.string().optional().default("AU"),
    site: z.string().optional().nullable(),
  })
  .passthrough();

export type ImportJobItem = z.infer<typeof ImportJobItemSchema>;

export interface ImportJobsResult {
  imported: number;
  invalid: number;
}

const BATCH_SIZE = 200;

/**
 * Normalise → tombstone-filter → dedupe → atomic batch insert for one user.
 *
 * Single source of truth for job ingestion. The DB unique(userId, jobUrl) +
 * skipDuplicates makes the createMany idempotent under concurrent imports
 * (no find-then-create race), and DeletedJobUrl tombstones keep a job the user
 * deleted from resurrecting on a re-fetch — the same guarantees whether the
 * rows came from the server-side fetcher or the user's browser extension.
 */
export async function importJobsForUser({
  userId,
  items,
}: {
  userId: string;
  items: ImportJobItem[];
}): Promise<ImportJobsResult> {
  let invalid = 0;
  const normalizedRaw = items
    .map((it) => {
      const jobUrl = canonicalizeJobUrl(it.jobUrl ?? it.job_url ?? "");
      const title = it.title?.trim();
      if (!jobUrl || !title) {
        invalid += 1;
        return null;
      }
      const rawListing = it.listingDate ?? it.listing_date ?? null;
      const parsedListing = rawListing ? new Date(rawListing) : null;
      const listingDate =
        parsedListing && !Number.isNaN(parsedListing.getTime()) ? parsedListing : null;
      return {
        jobUrl,
        title,
        company: it.company ?? null,
        location: it.location ?? null,
        jobType: it.jobType ?? it.job_type ?? null,
        jobLevel: it.jobLevel ?? it.job_level ?? null,
        description: it.description ?? null,
        salary: it.salary ?? null,
        workArrangement: it.workArrangement ?? it.work_arrangement ?? null,
        listingDate,
        market: it.market ?? "AU",
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const deletedUrls = await prisma.deletedJobUrl.findMany({
    where: { userId },
    select: { jobUrl: true },
  });
  const deletedSet = new Set(deletedUrls.map((it) => canonicalizeJobUrl(it.jobUrl)));

  const seen = new Set<string>();
  const normalized = normalizedRaw.filter((it) => {
    if (seen.has(it.jobUrl)) return false;
    if (deletedSet.has(it.jobUrl)) return false;
    seen.add(it.jobUrl);
    return true;
  });

  if (normalized.length === 0) {
    return { imported: 0, invalid };
  }

  let written = 0;
  for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
    const batch = normalized.slice(i, i + BATCH_SIZE);
    const result = await prisma.job.createMany({
      data: batch.map((current) => ({
        userId,
        jobUrl: current.jobUrl,
        title: current.title,
        company: current.company,
        location: current.location,
        jobType: current.jobType,
        jobLevel: current.jobLevel,
        description: current.description,
        salary: current.salary,
        workArrangement: current.workArrangement,
        listingDate: current.listingDate,
        market: current.market,
        status: "NEW",
      })),
      skipDuplicates: true,
    });
    written += result.count;
  }

  return { imported: written, invalid };
}
