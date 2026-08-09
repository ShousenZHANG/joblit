import { Prisma, type PrismaClient } from "../../generated/prisma";
import { acquireApplicationMutationLock } from "../applications/applicationMutationLock";
import {
  canonicalizeApplicationArtifactStorageIdentity,
  enqueueApplicationArtifactRetirements,
  prepareApplicationArtifactsForJobRetirement,
} from "../artifacts/applicationArtifactLifecycle";
import {
  lockApplicationBatchesForJobDeletion,
  reconcileApplicationBatchesAfterJobDeletion,
} from "../applicationBatches/batchReconciliation";
import { acquireFetchRunLifecycleLock } from "../fetchRuns/fetchRunLifecycleLock";
import { acquireJobMutationLock } from "../jobs/jobMutationLock";

const LEGACY_FETCH_MARKETS = ["CN", "GLOBAL"] as const;
const GLOBAL_MARKET = "GLOBAL";
const TRANSACTION_TIMEOUT_MS = 30_000;

export const LEGACY_MARKET_RETIREMENT_DEFAULTS = {
  batchSize: 25,
  maxBatches: 20,
} as const;

type RetirementDatabase = Pick<
  PrismaClient,
  | "$transaction"
  | "$queryRaw"
  | "application"
  | "applicationArtifactInventoryCheckpoint"
  | "fetchRun"
  | "fetchRunCommitReceipt"
  | "job"
>;

type ArtifactProjection = {
  id: string;
  jobId: string | null;
  resumeTexUrl: string | null;
  resumePdfUrl: string | null;
  coverTexUrl: string | null;
  coverPdfUrl: string | null;
};

type RetirementArtifact = {
  target: "RESUME_PDF" | "COVER_PDF" | "RESUME_TEX" | "COVER_TEX";
  url: string;
};

export type LegacyMarketRetirementPreview = {
  globalJobs: number;
  globalApplications: number;
  legacyFetchRuns: number;
  legacyFetchRunReceipts: number;
  activeOrphanArtifacts: number;
  inventoryCompleted: boolean;
  inventoryCompletedAt: string | null;
};

export type LegacyMarketRetirementSummary = {
  mode: "DRY_RUN" | "EXECUTE";
  preview: LegacyMarketRetirementPreview;
  jobs: {
    batchesProcessed: number;
    selected: number;
    deleted: number;
    applicationsDeleted: number;
    evidenceSnapshotsDeleted: number;
    artifactsQueued: number;
    artifactsDeleting: number;
    applicationBatchesReconciled: number;
    remaining: number;
  };
  fetchRuns: {
    batchesProcessed: number;
    selected: number;
    deleted: number;
    receiptsDeleted: number;
    remaining: number;
  };
  artifactReconciliation: {
    activeOrphans: number;
    inventoryCompleted: boolean;
    inventoryCompletedAt: string | null;
  };
  capped: boolean;
  stage2Ready: boolean;
  failure?: {
    phase: "GLOBAL_JOBS" | "LEGACY_FETCH_RUNS";
    batch: number;
    selected: number;
  };
};

export class LegacyMarketRetirementExecutionError extends Error {
  readonly summary: LegacyMarketRetirementSummary;

  constructor(
    message: string,
    summary: LegacyMarketRetirementSummary,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LegacyMarketRetirementExecutionError";
    this.summary = summary;
  }
}

type RetireOptions = {
  dryRun?: boolean;
  batchSize?: number;
  maxBatches?: number;
  database: RetirementDatabase;
};

function requireBoundedInteger(
  value: number,
  label: string,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${label} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function artifactIdentity(url: string): string {
  return (
    canonicalizeApplicationArtifactStorageIdentity(url)?.key ?? `legacy:${url}`
  );
}

function applicationArtifacts(application: ArtifactProjection): RetirementArtifact[] {
  const seen = new Set<string>();
  const candidates = [
    { target: "RESUME_PDF" as const, url: application.resumePdfUrl },
    { target: "COVER_PDF" as const, url: application.coverPdfUrl },
    { target: "RESUME_TEX" as const, url: application.resumeTexUrl },
    { target: "COVER_TEX" as const, url: application.coverTexUrl },
  ];
  return candidates.flatMap((candidate) => {
    const url = candidate.url?.trim();
    if (!url) return [];
    const identity = artifactIdentity(url);
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [{ target: candidate.target, url }];
  });
}

async function enqueueArtifactRetirements(
  tx: Prisma.TransactionClient,
  userId: string,
  applications: readonly ArtifactProjection[],
): Promise<number> {
  const seen = new Set<string>();
  let queued = 0;
  const ordered = [...applications].sort((left, right) =>
    `${left.jobId ?? ""}:${left.id}`.localeCompare(`${right.jobId ?? ""}:${right.id}`),
  );
  for (const application of ordered) {
    if (!application.jobId) continue;
    const artifacts = applicationArtifacts(application).filter((artifact) => {
      const identity = artifactIdentity(artifact.url);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
    if (artifacts.length === 0) continue;
    const retirement = await enqueueApplicationArtifactRetirements(tx, {
      userId,
      jobId: application.jobId,
      applicationId: application.id,
      artifacts,
    });
    queued += retirement.queued;
  }
  return queued;
}

async function lockGlobalJobRows(
  tx: Prisma.TransactionClient,
  userId: string,
  jobIds: readonly string[],
): Promise<string[]> {
  if (jobIds.length === 0) return [];
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Job"
    WHERE "userId" = ${userId}
      AND "market" = ${GLOBAL_MARKET}
      AND "id" IN (${Prisma.join(jobIds)})
    ORDER BY "id" ASC
    FOR UPDATE
  `;
  return rows.map((row) => row.id);
}

/**
 * Delete one user's GLOBAL Jobs with the same lock and cleanup invariants as
 * the interactive permanent-delete path, but deliberately without creating a
 * DeletedJobUrl tombstone. The market predicate remains on the final write so
 * a stale discovery page cannot delete a row that no longer belongs to this
 * retirement scope.
 */
export async function retireGlobalJobsForUser(
  database: RetirementDatabase,
  input: { userId: string; jobIds: readonly string[] },
): Promise<{
  selected: number;
  deleted: number;
  applicationsDeleted: number;
  evidenceSnapshotsDeleted: number;
  artifactsQueued: number;
  artifactsDeleting: number;
  applicationBatchesReconciled: number;
}> {
  const requestedIds = [...new Set(input.jobIds)].sort();
  if (requestedIds.length === 0) {
    return {
      selected: 0,
      deleted: 0,
      applicationsDeleted: 0,
      evidenceSnapshotsDeleted: 0,
      artifactsQueued: 0,
      artifactsDeleting: 0,
      applicationBatchesReconciled: 0,
    };
  }

  return database.$transaction(
    async (tx) => {
      // This must remain the first operation: imports and permanent deletion
      // serialize on JOBJ. Narrower ABAT and JOBA locks follow it.
      await acquireJobMutationLock(tx, input.userId);
      // The locked rows, not an earlier discovery read, are authoritative.
      // A row that left GLOBAL before this lock must keep every dependent row.
      const jobIds = await lockGlobalJobRows(tx, input.userId, requestedIds);
      if (jobIds.length === 0) {
        return {
          selected: 0,
          deleted: 0,
          applicationsDeleted: 0,
          evidenceSnapshotsDeleted: 0,
          artifactsQueued: 0,
          artifactsDeleting: 0,
          applicationBatchesReconciled: 0,
        };
      }
      const batchIds = await lockApplicationBatchesForJobDeletion(tx, {
        userId: input.userId,
        jobIds,
      });
      for (const jobId of jobIds) {
        await acquireApplicationMutationLock(tx, input.userId, jobId);
      }

      const applications = await tx.application.findMany({
        where: { userId: input.userId, jobId: { in: jobIds } },
        orderBy: [{ jobId: "asc" }, { id: "asc" }],
        select: {
          id: true,
          jobId: true,
          resumeTexUrl: true,
          resumePdfUrl: true,
          coverTexUrl: true,
          coverPdfUrl: true,
        },
      });
      const evidenceRows = applications.length
        ? await tx.claimEvidence.findMany({
            where: {
              userId: input.userId,
              applicationId: { in: applications.map((application) => application.id) },
            },
            select: { evidenceSnapshotId: true },
          })
        : [];
      const evidenceSnapshotIds = [
        ...new Set(evidenceRows.map((row) => row.evidenceSnapshotId)),
      ];

      // Durable DELETE_PENDING rows must exist before the Application pointers
      // disappear. Blob deletion remains the reconciler's responsibility.
      await enqueueArtifactRetirements(
        tx,
        input.userId,
        applications,
      );
      const preparedArtifacts = await prepareApplicationArtifactsForJobRetirement(
        tx,
        {
          userId: input.userId,
          jobIds,
          applicationIds: applications.map((application) => application.id),
        },
      );
      const deletedApplications = await tx.application.deleteMany({
        where: { userId: input.userId, jobId: { in: jobIds } },
      });
      const evidenceIdentities: Prisma.EvidenceSnapshotWhereInput[] = [
        { jobId: { in: jobIds } },
      ];
      if (applications.length > 0) {
        evidenceIdentities.push({
          applicationId: {
            in: applications.map((application) => application.id),
          },
        });
      }
      if (evidenceSnapshotIds.length > 0) {
        evidenceIdentities.push({ id: { in: evidenceSnapshotIds } });
      }
      const deletedEvidence = await tx.evidenceSnapshot.deleteMany({
        where: {
          userId: input.userId,
          OR: evidenceIdentities,
          claims: { none: {} },
        },
      });
      const deletedJobs = await tx.job.deleteMany({
        where: {
          id: { in: jobIds },
          userId: input.userId,
          market: GLOBAL_MARKET,
        },
      });
      if (deletedJobs.count !== jobIds.length) {
        throw new Error(
          `GLOBAL Job retirement lost its locked scope: expected ${jobIds.length}, deleted ${deletedJobs.count}`,
        );
      }
      await reconcileApplicationBatchesAfterJobDeletion(tx, {
        userId: input.userId,
        batchIds,
      });

      return {
        selected: jobIds.length,
        deleted: deletedJobs.count,
        applicationsDeleted: deletedApplications.count,
        evidenceSnapshotsDeleted: deletedEvidence.count,
        artifactsQueued: preparedArtifacts.queued,
        artifactsDeleting: preparedArtifacts.deleting,
        applicationBatchesReconciled: batchIds.length,
      };
    },
    { timeout: TRANSACTION_TIMEOUT_MS },
  );
}

export async function retireLegacyFetchRuns(
  database: RetirementDatabase,
  runIds: readonly string[],
): Promise<{ selected: number; deleted: number; receiptsDeleted: number }> {
  const requestedIds = [...new Set(runIds)].sort();
  if (requestedIds.length === 0) {
    return { selected: 0, deleted: 0, receiptsDeleted: 0 };
  }
  return database.$transaction(
    async (tx) => {
      // A commit/cancel holding FRUN finishes before deletion; a later legacy
      // writer finds no run. Stable lock order also prevents cleanup workers
      // from deadlocking each other.
      for (const runId of requestedIds) {
        await acquireFetchRunLifecycleLock(tx, runId);
      }
      const runs = await tx.fetchRun.findMany({
        where: {
          id: { in: requestedIds },
          market: { in: [...LEGACY_FETCH_MARKETS] },
        },
        orderBy: { id: "asc" },
        select: { id: true },
      });
      const ownedIds = runs.map((run) => run.id);
      if (ownedIds.length === 0) {
        return { selected: 0, deleted: 0, receiptsDeleted: 0 };
      }
      const receiptsDeleted = await tx.fetchRunCommitReceipt.count({
        where: { fetchRunId: { in: ownedIds } },
      });
      const deleted = await tx.fetchRun.deleteMany({
        where: {
          id: { in: ownedIds },
          market: { in: [...LEGACY_FETCH_MARKETS] },
        },
      });
      return {
        selected: ownedIds.length,
        deleted: deleted.count,
        receiptsDeleted,
      };
    },
    { timeout: TRANSACTION_TIMEOUT_MS },
  );
}

export async function previewLegacyMarketRetirement(
  database: RetirementDatabase,
): Promise<LegacyMarketRetirementPreview> {
  const [
    globalJobs,
    globalApplications,
    legacyFetchRuns,
    legacyFetchRunReceipts,
    activeOrphanArtifacts,
    inventoryCheckpoint,
  ] =
    await Promise.all([
      database.job.count({ where: { market: GLOBAL_MARKET } }),
      database.application.count({ where: { job: { market: GLOBAL_MARKET } } }),
      database.fetchRun.count({
        where: { market: { in: [...LEGACY_FETCH_MARKETS] } },
      }),
      database.fetchRunCommitReceipt.count({
        where: {
          fetchRun: { market: { in: [...LEGACY_FETCH_MARKETS] } },
        },
      }),
      countActiveOrphanArtifacts(database),
      readCompletedArtifactInventory(database),
    ]);
  return {
    globalJobs,
    globalApplications,
    legacyFetchRuns,
    legacyFetchRunReceipts,
    activeOrphanArtifacts,
    inventoryCompleted: inventoryCheckpoint.completed,
    inventoryCompletedAt: inventoryCheckpoint.completedAt,
  };
}

const ARTIFACT_INVENTORY_CHECKPOINT_KEY = "vercel-applications-v1";

async function readCompletedArtifactInventory(
  database: RetirementDatabase,
): Promise<{ completed: boolean; completedAt: string | null }> {
  const checkpoint =
    await database.applicationArtifactInventoryCheckpoint.findUnique({
      where: { key: ARTIFACT_INVENTORY_CHECKPOINT_KEY },
      select: {
        cursor: true,
        claimId: true,
        claimLeaseExpiresAt: true,
        scanStartedAt: true,
        completedAt: true,
      },
    });
  const settled = Boolean(
    checkpoint?.completedAt &&
      checkpoint.cursor === null &&
      checkpoint.claimId === null &&
      checkpoint.claimLeaseExpiresAt === null &&
      checkpoint.scanStartedAt === null,
  );
  return {
    completed: settled,
    completedAt: settled ? checkpoint!.completedAt!.toISOString() : null,
  };
}

async function countActiveOrphanArtifacts(
  database: RetirementDatabase,
): Promise<number> {
  const rows = await database.$queryRaw<Array<{ count: bigint | number | string }>>(
    Prisma.sql`
      SELECT COUNT(*) AS "count"
      FROM "ApplicationArtifact" artifact
      LEFT JOIN "Job" job
        ON job."id" = artifact."jobId"
       AND job."userId" = artifact."userId"
      LEFT JOIN "Application" application
        ON application."id" = artifact."applicationId"
       AND application."userId" = artifact."userId"
      WHERE artifact."state" IN (
        'STAGED'::"ApplicationArtifactState",
        'REFERENCED'::"ApplicationArtifactState",
        'DELETE_PENDING'::"ApplicationArtifactState",
        'DELETING'::"ApplicationArtifactState"
      )
        AND (
          (artifact."jobId" IS NOT NULL AND job."id" IS NULL)
          OR (
            artifact."applicationId" IS NOT NULL
            AND application."id" IS NULL
          )
        )
    `,
  );
  const count = Number(rows[0]?.count ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Active orphan artifact count is invalid");
  }
  return count;
}

function emptySummary(
  mode: LegacyMarketRetirementSummary["mode"],
  preview: LegacyMarketRetirementPreview,
): LegacyMarketRetirementSummary {
  return {
    mode,
    preview,
    jobs: {
      batchesProcessed: 0,
      selected: 0,
      deleted: 0,
      applicationsDeleted: 0,
      evidenceSnapshotsDeleted: 0,
      artifactsQueued: 0,
      artifactsDeleting: 0,
      applicationBatchesReconciled: 0,
      remaining: preview.globalJobs,
    },
    fetchRuns: {
      batchesProcessed: 0,
      selected: 0,
      deleted: 0,
      receiptsDeleted: 0,
      remaining: preview.legacyFetchRuns,
    },
    artifactReconciliation: {
      activeOrphans: preview.activeOrphanArtifacts,
      inventoryCompleted: preview.inventoryCompleted,
      inventoryCompletedAt: preview.inventoryCompletedAt,
    },
    capped: false,
    stage2Ready:
      preview.globalJobs === 0 &&
      preview.legacyFetchRuns === 0 &&
      preview.activeOrphanArtifacts === 0 &&
      preview.inventoryCompleted,
  };
}

/**
 * Bounded, resumable Stage-1 retirement. Each invocation processes at most
 * `maxBatches * batchSize` GLOBAL Jobs and the same number of legacy FetchRuns.
 * Re-running is safe: discovery and final writes both retain their market
 * predicates, and all lifecycle writes are idempotent.
 */
export async function retireLegacyMarketData(
  options: RetireOptions,
): Promise<LegacyMarketRetirementSummary> {
  const database = options.database;
  const batchSize = requireBoundedInteger(
    options.batchSize ?? LEGACY_MARKET_RETIREMENT_DEFAULTS.batchSize,
    "batchSize",
    100,
  );
  const maxBatches = requireBoundedInteger(
    options.maxBatches ?? LEGACY_MARKET_RETIREMENT_DEFAULTS.maxBatches,
    "maxBatches",
    1_000,
  );
  const preview = await previewLegacyMarketRetirement(database);
  const summary = emptySummary(options.dryRun === false ? "EXECUTE" : "DRY_RUN", preview);
  if (summary.mode === "DRY_RUN") return summary;
  let failureScope: LegacyMarketRetirementSummary["failure"];

  try {
    for (let batch = 0; batch < maxBatches; batch += 1) {
      failureScope = { phase: "GLOBAL_JOBS", batch: batch + 1, selected: 0 };
      const jobs = await database.job.findMany({
        where: { market: GLOBAL_MARKET },
        orderBy: [{ userId: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true, userId: true },
      });
      if (jobs.length === 0) break;
      failureScope = {
        phase: "GLOBAL_JOBS",
        batch: batch + 1,
        selected: jobs.length,
      };
      summary.jobs.batchesProcessed += 1;
      const jobsByUser = new Map<string, string[]>();
      for (const job of jobs) {
        const ids = jobsByUser.get(job.userId) ?? [];
        ids.push(job.id);
        jobsByUser.set(job.userId, ids);
      }
      for (const [userId, jobIds] of jobsByUser) {
        const result = await retireGlobalJobsForUser(database, { userId, jobIds });
        summary.jobs.selected += result.selected;
        summary.jobs.deleted += result.deleted;
        summary.jobs.applicationsDeleted += result.applicationsDeleted;
        summary.jobs.evidenceSnapshotsDeleted += result.evidenceSnapshotsDeleted;
        summary.jobs.artifactsQueued += result.artifactsQueued;
        summary.jobs.artifactsDeleting += result.artifactsDeleting;
        summary.jobs.applicationBatchesReconciled +=
          result.applicationBatchesReconciled;
      }
    }

    for (let batch = 0; batch < maxBatches; batch += 1) {
      failureScope = {
        phase: "LEGACY_FETCH_RUNS",
        batch: batch + 1,
        selected: 0,
      };
      const runs = await database.fetchRun.findMany({
        where: { market: { in: [...LEGACY_FETCH_MARKETS] } },
        orderBy: [{ userId: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true },
      });
      if (runs.length === 0) break;
      failureScope = {
        phase: "LEGACY_FETCH_RUNS",
        batch: batch + 1,
        selected: runs.length,
      };
      summary.fetchRuns.batchesProcessed += 1;
      const result = await retireLegacyFetchRuns(
        database,
        runs.map((run) => run.id),
      );
      summary.fetchRuns.selected += result.selected;
      summary.fetchRuns.deleted += result.deleted;
      summary.fetchRuns.receiptsDeleted += result.receiptsDeleted;
    }
  } catch (error) {
    summary.failure = failureScope;
    summary.capped = true;
    try {
      const [remainingJobs, remainingFetchRuns, activeOrphans, inventory] =
        await Promise.all([
          database.job.count({ where: { market: GLOBAL_MARKET } }),
          database.fetchRun.count({
            where: { market: { in: [...LEGACY_FETCH_MARKETS] } },
          }),
          countActiveOrphanArtifacts(database),
          readCompletedArtifactInventory(database),
        ]);
      summary.jobs.remaining = remainingJobs;
      summary.fetchRuns.remaining = remainingFetchRuns;
      summary.artifactReconciliation.activeOrphans = activeOrphans;
      summary.artifactReconciliation.inventoryCompleted = inventory.completed;
      summary.artifactReconciliation.inventoryCompletedAt = inventory.completedAt;
    } catch {
      // Preserve the last trustworthy counters if the verification query also
      // fails; the original cause remains authoritative.
    }
    throw new LegacyMarketRetirementExecutionError(
      "A bounded retirement batch failed; earlier committed batches were not rolled back",
      summary,
      { cause: error },
    );
  }

  const [remainingJobs, remainingFetchRuns, activeOrphans, inventory] =
    await Promise.all([
      database.job.count({ where: { market: GLOBAL_MARKET } }),
      database.fetchRun.count({
        where: { market: { in: [...LEGACY_FETCH_MARKETS] } },
      }),
      countActiveOrphanArtifacts(database),
      readCompletedArtifactInventory(database),
    ]);
  summary.jobs.remaining = remainingJobs;
  summary.fetchRuns.remaining = remainingFetchRuns;
  summary.artifactReconciliation.activeOrphans = activeOrphans;
  summary.artifactReconciliation.inventoryCompleted = inventory.completed;
  summary.artifactReconciliation.inventoryCompletedAt = inventory.completedAt;
  summary.capped = remainingJobs > 0 || remainingFetchRuns > 0;
  summary.stage2Ready =
    remainingJobs === 0 &&
    remainingFetchRuns === 0 &&
    activeOrphans === 0 &&
    inventory.completed;
  return summary;
}
