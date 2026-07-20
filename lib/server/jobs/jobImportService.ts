import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { canonicalizeJobUrl } from "@/lib/shared/canonicalizeJobUrl";
import { scorePostingRisk } from "@/lib/server/jobs/postingRisk";
import { buildCompanyRoleKey } from "@/lib/server/jobs/companyRoleKey";
import { computeSimHash64 } from "@/lib/server/jobs/simHash";
import {
  buildUserCooldownFilter,
  inferApplicationRoleFamily,
} from "@/lib/server/jobs/applicationCooldownService";
import { reportError } from "@/lib/server/observability/errorReporter";
import { acquireJobMutationLock } from "@/lib/server/jobs/jobMutationLock";
import { sanitizePipelineUrl } from "@/lib/server/security/untrustedOutput";

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
    market: z.enum(["AU", "CN", "GLOBAL"]).optional().default("AU"),
    source: z.string().trim().max(60).optional().nullable(),
    site: z.string().trim().max(120).optional().nullable(),
  })
  .passthrough();

type ImportJobItem = z.infer<typeof ImportJobItemSchema>;

interface ImportJobsResult {
  imported: number;
  invalid: number;
}

const BATCH_SIZE = 200;
const IMPORT_TRANSACTION_TIMEOUT_MS = 30_000;
const ENRICHMENT_COLUMNS = [
  "source",
  "postingrisk",
  "postingriskflags",
  "companyrolekey",
  "descriptionsimhash",
  "livenessstatus",
  "livenessreason",
  "livenesscheckedat",
  "lastseenat",
] as const;

function optionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function normalizeSource(value: string | null | undefined): string | null {
  const source = optionalText(value)?.toLocaleLowerCase() ?? null;
  return source === "linkedin" ? "jobspy" : source;
}

function isEnrichmentMigrationRace(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    meta?: unknown;
  };
  if (candidate.code !== "P2022") return false;
  const detail = `${String(candidate.message ?? "")} ${JSON.stringify(candidate.meta ?? {})}`
    .toLocaleLowerCase();
  return ENRICHMENT_COLUMNS.some((column) => detail.includes(column));
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
  const observedAt = new Date();
  const normalizedRaw = items
    .map((candidate) => {
      // Public routes parse with this schema before calling us, but internal
      // producers (source adapters, CN fetchers, tests) can otherwise bypass
      // that runtime boundary through TypeScript's structural typing. Parse
      // again at the shared persistence boundary so oversized or malformed
      // third-party rows never reach Prisma.
      const parsed = ImportJobItemSchema.safeParse(candidate);
      if (!parsed.success) {
        invalid += 1;
        return null;
      }
      const it = parsed.data;
      const jobUrl = sanitizePipelineUrl(
        canonicalizeJobUrl(it.jobUrl ?? it.job_url ?? ""),
      );
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
      const description = optionalText(it.description);
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
        description,
        salary: optionalText(it.salary),
        workArrangement:
          optionalText(it.workArrangement) ??
          optionalText(it.work_arrangement),
        listingDate,
        market: it.market ?? "AU",
        source: normalizeSource(it.source ?? it.site),
        postingRisk: risk.score,
        postingRiskFlags: risk.flags,
        companyRoleKey: buildCompanyRoleKey({ company, title }),
        descriptionSimHash: description ? computeSimHash64(description) : null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const seen = new Set<string>();
  const deduplicated = normalizedRaw.filter((it) => {
    if (seen.has(it.jobUrl)) return false;
    seen.add(it.jobUrl);
    return true;
  });

  let eligibleForImport = deduplicated;
  if (deduplicated.length > 0) {
    try {
      const keep = await buildUserCooldownFilter(userId);
      eligibleForImport = deduplicated.filter((item) =>
        keep({
          company: item.company ?? "",
          title: item.title,
          roleFamily: inferApplicationRoleFamily(item.title),
        }),
      );
    } catch (error) {
      // Cooldown is additive policy. During the ApplicationEvent migration,
      // fail open rather than silently losing otherwise valid job discoveries.
      reportError(error, {
        scope: "jobs.import.cooldown_unavailable",
        severity: "warning",
        userId,
      });
    }
  }

  if (eligibleForImport.length === 0) {
    return { imported: 0, invalid };
  }

  async function runImportTransaction(includeEnrichment: boolean): Promise<number> {
    return prisma.$transaction(
      async (tx) => {
        // Lock first. A delete for this user cannot commit a tombstone between
        // this read and the inserts below.
        await acquireJobMutationLock(tx, userId);

        const deletedUrls = await tx.deletedJobUrl.findMany({
          where: {
            userId,
            jobUrl: { in: eligibleForImport.map((item) => item.jobUrl) },
          },
          select: { jobUrl: true },
        });
        const deletedSet = new Set(
          deletedUrls.map((item) => canonicalizeJobUrl(item.jobUrl)),
        );
        const normalized = eligibleForImport.filter(
          (item) => !deletedSet.has(item.jobUrl),
        );

        let written = 0;
        for (let index = 0; index < normalized.length; index += BATCH_SIZE) {
          const batch = normalized.slice(index, index + BATCH_SIZE);
          const baseData = batch.map((current) => ({
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
            status: "NEW" as const,
          }));
          const data = includeEnrichment
            ? baseData.map((current, batchIndex) => ({
                ...current,
                source: batch[batchIndex]?.source ?? null,
                postingRisk: batch[batchIndex]?.postingRisk ?? 0,
                postingRiskFlags:
                  batch[batchIndex]?.postingRiskFlags ?? [],
                companyRoleKey: batch[batchIndex]?.companyRoleKey ?? null,
                descriptionSimHash:
                  batch[batchIndex]?.descriptionSimHash ?? null,
                livenessStatus: "ACTIVE" as const,
                livenessReason: "import_reachable",
                livenessCheckedAt: observedAt,
                lastSeenAt: observedAt,
              }))
            : baseData;
          const result = await tx.job.createMany({
            data,
            skipDuplicates: true,
          });
          written += result.count;
          if (includeEnrichment) {
            // createMany intentionally skips existing canonical URLs. Seeing
            // one again is still a liveness signal, so refresh it in bulk.
            await tx.job.updateMany({
              where: {
                userId,
                jobUrl: { in: batch.map((item) => item.jobUrl) },
              },
              data: {
                livenessStatus: "ACTIVE",
                livenessReason: "import_reachable",
                livenessCheckedAt: observedAt,
                lastSeenAt: observedAt,
              },
            });
          }
        }
        return written;
      },
      { timeout: IMPORT_TRANSACTION_TIMEOUT_MS },
    );
  }

  let written: number;
  try {
    written = await runImportTransaction(true);
  } catch (error) {
    if (!isEnrichmentMigrationRace(error)) throw error;
    // A failed PostgreSQL statement aborts its transaction. Restart the whole
    // lock-read-filter-write sequence using only core columns; never retry a
    // statement inside the aborted transaction.
    reportError(error, {
      scope: "jobs.import.enrichment_migration_race",
      userId,
    });
    written = await runImportTransaction(false);
  }

  return { imported: written, invalid };
}
