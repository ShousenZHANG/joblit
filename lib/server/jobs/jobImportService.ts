import { prisma } from "@/lib/server/prisma";
import { canonicalizeJobUrl } from "@/lib/shared/canonicalizeJobUrl";
import {
  ImportJobItemSchema,
  type ImportJobItem,
} from "@/lib/shared/schemas/jobImport";
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

// Compatibility exports keep existing ingestion callers stable while the
// canonical wire schema lives in lib/shared.
export { ImportJobItemSchema };
export type { ImportJobItem };

export interface ImportJobsResult {
  imported: number;
  invalid: number;
}

interface PreparedJobItem {
  jobUrl: string;
  title: string;
  company: string | null;
  location: string | null;
  jobType: string | null;
  jobLevel: string | null;
  description: string | null;
  salary: string | null;
  workArrangement: string | null;
  listingDate: Date | null;
  market: "AU" | "CN" | "GLOBAL";
  source: string | null;
  postingRisk: number;
  postingRiskFlags: string[];
  companyRoleKey: string | null;
  descriptionSimHash: string | null;
}

type ParsedImportJobItem = ReturnType<typeof ImportJobItemSchema.parse>;
type JobImportTransaction = Parameters<typeof acquireJobMutationLock>[0];

export interface PreparedJobImport {
  invalid: number;
  observedAt: Date;
  items: PreparedJobItem[];
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

function parseListingDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toPreparedJobItem(
  item: ParsedImportJobItem,
  jobUrl: string,
  title: string,
): PreparedJobItem {
  const company = optionalText(item.company);
  const description = optionalText(item.description);
  const risk = scorePostingRisk({ jobUrl, company });
  return {
    jobUrl,
    title,
    company,
    location: optionalText(item.location),
    jobType: optionalText(item.jobType) ?? optionalText(item.job_type),
    jobLevel: optionalText(item.jobLevel) ?? optionalText(item.job_level),
    description,
    salary: optionalText(item.salary),
    workArrangement:
      optionalText(item.workArrangement) ??
      optionalText(item.work_arrangement),
    listingDate: parseListingDate(item.listingDate ?? item.listing_date),
    market: item.market,
    source: normalizeSource(item.source ?? item.site),
    postingRisk: risk.score,
    postingRiskFlags: [...risk.flags],
    companyRoleKey: buildCompanyRoleKey({ company, title }),
    descriptionSimHash: description ? computeSimHash64(description) : null,
  };
}

function normalizeJobItem(candidate: ImportJobItem): PreparedJobItem | null {
  // Internal producers can bypass a route schema through structural typing, so
  // parse again before any third-party row reaches the database.
  const parsed = ImportJobItemSchema.safeParse(candidate);
  if (!parsed.success) return null;
  const item = parsed.data;
  const jobUrl = sanitizePipelineUrl(
    canonicalizeJobUrl(item.jobUrl ?? item.job_url ?? ""),
  );
  const title = item.title.trim();
  if (!jobUrl || !title) return null;
  return toPreparedJobItem(item, jobUrl, title);
}

function normalizeJobItems(items: ImportJobItem[]): {
  items: PreparedJobItem[];
  invalid: number;
} {
  const normalized: PreparedJobItem[] = [];
  let invalid = 0;
  for (const candidate of items) {
    const item = normalizeJobItem(candidate);
    if (item) normalized.push(item);
    else invalid += 1;
  }
  return { items: normalized, invalid };
}

function dedupePreparedJobItems(
  items: readonly PreparedJobItem[],
): PreparedJobItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.jobUrl)) return false;
    seen.add(item.jobUrl);
    return true;
  });
}

async function applyApplicationCooldown(
  userId: string,
  items: readonly PreparedJobItem[],
): Promise<PreparedJobItem[]> {
  if (items.length === 0) return [];
  try {
    const keep = await buildUserCooldownFilter(userId);
    return items.filter((item) =>
      keep({
        company: item.company ?? "",
        title: item.title,
        roleFamily: inferApplicationRoleFamily(item.title),
      }),
    );
  } catch (error) {
    // Cooldown is additive policy. Fail open during a migration or outage.
    reportError(error, {
      scope: "jobs.import.cooldown_unavailable",
      severity: "warning",
      userId,
    });
    return [...items];
  }
}

export function isJobImportEnrichmentMigrationRace(error: unknown): boolean {
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
 * rows came from a current server-side fetcher or a retained legacy source.
 */
/**
 * Preparation intentionally stops before tombstone reads and writes. Those
 * operations run later under the caller's JOBJ transaction lock.
 */
export async function prepareJobImportForUser({
  userId,
  items,
}: {
  userId: string;
  items: ImportJobItem[];
}): Promise<PreparedJobImport> {
  const observedAt = new Date();
  const normalized = normalizeJobItems(items);
  const deduplicated = dedupePreparedJobItems(normalized.items);
  const eligible = await applyApplicationCooldown(userId, deduplicated);
  return { invalid: normalized.invalid, observedAt, items: eligible };
}

async function excludeTombstonedJobs(
  tx: JobImportTransaction,
  userId: string,
  items: readonly PreparedJobItem[],
): Promise<PreparedJobItem[]> {
  const deletedUrls = await tx.deletedJobUrl.findMany({
    where: {
      userId,
      jobUrl: { in: items.map((item) => item.jobUrl) },
    },
    select: { jobUrl: true },
  });
  const deleted = new Set(
    deletedUrls.map((item) => canonicalizeJobUrl(item.jobUrl)),
  );
  return items.filter((item) => !deleted.has(item.jobUrl));
}

function buildBaseJobRow(userId: string, item: PreparedJobItem) {
  return {
    userId,
    jobUrl: item.jobUrl,
    title: item.title,
    company: item.company,
    location: item.location,
    jobType: item.jobType,
    jobLevel: item.jobLevel,
    description: item.description,
    salary: item.salary,
    workArrangement: item.workArrangement,
    listingDate: item.listingDate,
    market: item.market,
    status: "NEW" as const,
  };
}

function buildJobCreateRows(
  userId: string,
  batch: readonly PreparedJobItem[],
  observedAt: Date,
  includeEnrichment: boolean,
) {
  const baseRows = batch.map((item) => buildBaseJobRow(userId, item));
  if (!includeEnrichment) return baseRows;
  return baseRows.map((row, index) => ({
    ...row,
    source: batch[index]?.source ?? null,
    postingRisk: batch[index]?.postingRisk ?? 0,
    postingRiskFlags: batch[index]?.postingRiskFlags ?? [],
    companyRoleKey: batch[index]?.companyRoleKey ?? null,
    descriptionSimHash: batch[index]?.descriptionSimHash ?? null,
    livenessStatus: "ACTIVE" as const,
    livenessReason: "import_reachable",
    livenessCheckedAt: observedAt,
    lastSeenAt: observedAt,
  }));
}

async function refreshSeenJobLiveness(
  tx: JobImportTransaction,
  userId: string,
  batch: readonly PreparedJobItem[],
  observedAt: Date,
): Promise<void> {
  await tx.job.updateMany({
    where: {
      userId,
      jobUrl: { in: batch.map((item) => item.jobUrl) },
      OR: [
        { livenessCheckedAt: null },
        { livenessCheckedAt: { lt: observedAt } },
      ],
    },
    data: {
      livenessStatus: "ACTIVE",
      livenessReason: "import_reachable",
      livenessCheckedAt: observedAt,
      lastSeenAt: observedAt,
    },
  });
}

async function persistPreparedJobBatch(
  tx: JobImportTransaction,
  userId: string,
  batch: readonly PreparedJobItem[],
  observedAt: Date,
  includeEnrichment: boolean,
): Promise<number> {
  const result = await tx.job.createMany({
    data: buildJobCreateRows(userId, batch, observedAt, includeEnrichment),
    skipDuplicates: true,
  });
  if (includeEnrichment) {
    await refreshSeenJobLiveness(tx, userId, batch, observedAt);
  }
  return result.count;
}

/**
 * Persist prepared jobs through an existing transaction. The global lock
 * order for run-bound imports is FRUN -> JOBJ; generic imports enter here with
 * no FRUN lock and acquire only JOBJ.
 */
export async function persistPreparedJobImport(
  tx: JobImportTransaction,
  {
    userId,
    prepared,
    includeEnrichment,
  }: {
    userId: string;
    prepared: PreparedJobImport;
    includeEnrichment: boolean;
  },
): Promise<number> {
  if (prepared.items.length === 0) return 0;
  await acquireJobMutationLock(tx, userId);
  const eligible = await excludeTombstonedJobs(tx, userId, prepared.items);
  let written = 0;
  for (let index = 0; index < eligible.length; index += BATCH_SIZE) {
    const batch = eligible.slice(index, index + BATCH_SIZE);
    written += await persistPreparedJobBatch(
      tx,
      userId,
      batch,
      prepared.observedAt,
      includeEnrichment,
    );
  }
  return written;
}

/**
 * Shallow convenience adapter for imports that do not participate in a wider
 * commit transaction.
 */
export async function importJobsForUser({
  userId,
  items,
}: {
  userId: string;
  items: ImportJobItem[];
}): Promise<ImportJobsResult> {
  const prepared = await prepareJobImportForUser({ userId, items });
  if (prepared.items.length === 0) {
    return { imported: 0, invalid: prepared.invalid };
  }

  async function runImportTransaction(includeEnrichment: boolean): Promise<number> {
    return prisma.$transaction(
      (tx) =>
        persistPreparedJobImport(tx, {
          userId,
          prepared,
          includeEnrichment,
        }),
      { timeout: IMPORT_TRANSACTION_TIMEOUT_MS },
    );
  }

  let written: number;
  try {
    written = await runImportTransaction(true);
  } catch (error) {
    if (!isJobImportEnrichmentMigrationRace(error)) throw error;
    reportError(error, {
      scope: "jobs.import.enrichment_migration_race",
      userId,
    });
    written = await runImportTransaction(false);
  }

  return { imported: written, invalid: prepared.invalid };
}
