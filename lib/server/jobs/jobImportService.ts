import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { canonicalizeJobUrl } from "@/lib/shared/canonicalizeJobUrl";
import { scorePostingRisk } from "@/lib/server/jobs/postingRisk";
import { buildCompanyRoleKey } from "@/lib/server/jobs/companyRoleKey";

// Canonical import-item schema, shared by every ingestion path (the Python
// fetcher via /api/admin/import, and the browser extension via
// /api/ext/jobs/import). Accepts both python snake_case and web camelCase
// field names so a single schema serves both producers.
export const ImportJobItemSchema = z
  .object({
    job_url: z.string().trim().max(2048).url().optional(),
    jobUrl: z.string().trim().max(2048).url().optional(),
    title: z.string().trim().min(2).max(240),
    company: z.string().trim().max(240).optional().nullable(),
    location: z.string().trim().max(240).optional().nullable(),
    job_type: z.string().trim().max(80).optional().nullable(),
    jobType: z.string().trim().max(80).optional().nullable(),
    job_level: z.string().trim().max(80).optional().nullable(),
    jobLevel: z.string().trim().max(80).optional().nullable(),
    description: z.string().trim().max(60_000).optional().nullable(),
    salary: z.string().trim().max(240).optional().nullable(),
    work_arrangement: z.string().trim().max(80).optional().nullable(),
    workArrangement: z.string().trim().max(80).optional().nullable(),
    listing_date: z.string().trim().max(80).optional().nullable(),
    listingDate: z.string().trim().max(80).optional().nullable(),
    market: z.enum(["AU", "CN"]).optional().default("AU"),
    site: z.string().trim().max(120).optional().nullable(),
  })
  .passthrough();

type ImportJobItem = z.infer<typeof ImportJobItemSchema>;

interface ImportJobsResult {
  imported: number;
  invalid: number;
}

const BATCH_SIZE = 200;

function optionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

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
      const company = optionalText(it.company);
      // Scored against the canonical URL so tracking parameters cannot change
      // the verdict for what is really the same posting.
      const risk = scorePostingRisk({ jobUrl, company });
      return {
        jobUrl,
        title,
        company,
        location: optionalText(it.location),
        jobType: optionalText(it.jobType) ?? optionalText(it.job_type),
        jobLevel: optionalText(it.jobLevel) ?? optionalText(it.job_level),
        description: optionalText(it.description),
        salary: optionalText(it.salary),
        workArrangement:
          optionalText(it.workArrangement) ??
          optionalText(it.work_arrangement),
        listingDate,
        market: it.market ?? "AU",
        postingRisk: risk.score,
        postingRiskFlags: risk.flags,
        companyRoleKey: buildCompanyRoleKey({ company, title }),
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
        postingRisk: current.postingRisk,
        postingRiskFlags: current.postingRiskFlags,
        companyRoleKey: current.companyRoleKey,
        status: "NEW",
      })),
      skipDuplicates: true,
    });
    written += result.count;
  }

  return { imported: written, invalid };
}
