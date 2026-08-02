import { prisma } from "@/lib/server/prisma";
import { canonicalizeJobUrl } from "@/lib/shared/canonicalizeJobUrl";
import { acquireJobMutationLock } from "@/lib/server/jobs/jobMutationLock";
import { acquireApplicationMutationLock } from "@/lib/server/applications/applicationMutationLock";
import {
  canonicalizeApplicationArtifactStorageIdentity,
  enqueueApplicationArtifactRetirements,
} from "@/lib/server/artifacts/applicationArtifactLifecycle";
import { Prisma } from "@/lib/generated/prisma";
import {
  lockApplicationBatchesForJobDeletion,
  reconcileApplicationBatchesAfterJobDeletion,
} from "@/lib/server/applicationBatches/batchReconciliation";

type ArtifactRetirementResult = { queued: number };
type LegacyBlobCleanupResult = {
  attempted: number;
  deleted: number;
  failed: number;
};

type JobDeleteResult =
  | { alreadyDeleted: true }
  | {
      alreadyDeleted: false;
      artifactRetirement: ArtifactRetirementResult;
      /** @deprecated Use artifactRetirement.queued. */
      blobCleanup: LegacyBlobCleanupResult;
    };

type BatchDeleteResult = {
  deleted: number;
  notFound: number;
  artifactRetirement: ArtifactRetirementResult;
  /** @deprecated Use artifactRetirement.queued. */
  blobCleanup: LegacyBlobCleanupResult;
};

const JOB_MUTATION_TRANSACTION_TIMEOUT_MS = 30_000;

/**
 * Fence even pre-JOBJ ApplicationBatch writers during an expand cutover.
 * PostgreSQL's FK check takes a key-share lock on each Job; this ordered
 * FOR UPDATE either waits for that task insert to commit (so the subsequent
 * batch-task read sees it) or makes the insert wait and fail after deletion.
 */
async function lockOwnedJobRowsForDeletion(
  tx: Prisma.TransactionClient,
  userId: string,
  jobIds: readonly string[],
): Promise<void> {
  const orderedJobIds = [...new Set(jobIds)].sort();
  if (orderedJobIds.length === 0) return;
  await tx.$queryRaw`
    SELECT "id"
    FROM "Job"
    WHERE "userId" = ${userId}
      AND "id" IN (${Prisma.join(orderedJobIds)})
    ORDER BY "id" ASC
    FOR UPDATE
  `;
}

type ApplicationArtifactProjection = {
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

function retirementIdentity(url: string): string {
  return (
    canonicalizeApplicationArtifactStorageIdentity(url)?.key ?? `legacy:${url}`
  );
}

function retirementArtifacts(
  application: ApplicationArtifactProjection,
): RetirementArtifact[] {
  const seen = new Set<string>();
  return [
    { target: "RESUME_PDF" as const, url: application.resumePdfUrl },
    { target: "COVER_PDF" as const, url: application.coverPdfUrl },
    { target: "RESUME_TEX" as const, url: application.resumeTexUrl },
    { target: "COVER_TEX" as const, url: application.coverTexUrl },
  ].flatMap((artifact) => {
    const url = typeof artifact.url === "string" ? artifact.url.trim() : "";
    if (!url) return [];
    const identity = retirementIdentity(url);
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [{ target: artifact.target, url }];
  });
}

function artifactRetirementResult(queued: number): {
  artifactRetirement: ArtifactRetirementResult;
  blobCleanup: LegacyBlobCleanupResult;
} {
  return {
    artifactRetirement: { queued },
    // Compatibility only: no Blob call occurs in this request.
    blobCleanup: { attempted: queued, deleted: 0, failed: 0 },
  };
}

async function enqueueApplicationRetirements(
  tx: Prisma.TransactionClient,
  userId: string,
  applications: readonly ApplicationArtifactProjection[],
): Promise<number> {
  let queued = 0;
  const seenIdentities = new Set<string>();
  const ordered = [...applications].sort((left, right) =>
    `${left.jobId ?? ""}:${left.id}`.localeCompare(
      `${right.jobId ?? ""}:${right.id}`,
    ),
  );
  for (const application of ordered) {
    if (!application.jobId) continue;
    const artifacts = retirementArtifacts(application).filter((artifact) => {
      const identity = retirementIdentity(artifact.url);
      if (seenIdentities.has(identity)) return false;
      seenIdentities.add(identity);
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

/**
 * Remove the evidence snapshots the deleted Jobs leave behind.
 *
 * Both of `EvidenceSnapshot`'s foreign keys are `SetNull`, and nothing else in
 * the codebase deletes the table, so without this a deleted Job left its
 * extracted JD text and resume claims in Postgres with every non-user key null
 * — unreachable through each index the model declares, and removable only by
 * deleting the account.
 *
 * Two constraints shape this. Candidate ids must be captured *before* the
 * Application delete because a snapshot shared from an older Job may already
 * have `jobId = null`; deletion must run *after* that Application delete so its
 * ClaimEvidence edges have cascaded. It must still skip any snapshot another
 * Application cites or a retained STAR story uses as provenance: ids are
 * content-addressed on `(userId, kind, contentHash)` rather than on the Job.
 */
type EvidenceCleanupTransaction = Pick<
  Prisma.TransactionClient,
  "claimEvidence" | "evidenceSnapshot"
>;

async function collectEvidenceSnapshotIds(
  tx: EvidenceCleanupTransaction,
  userId: string,
  applicationIds: string[],
): Promise<string[]> {
  if (applicationIds.length === 0) return [];
  const rows = await tx.claimEvidence.findMany({
    where: {
      userId,
      applicationId: { in: applicationIds },
    },
    select: { evidenceSnapshotId: true },
  });
  return [...new Set(rows.map((row) => row.evidenceSnapshotId))];
}

async function deleteUnreferencedEvidence(
  tx: EvidenceCleanupTransaction,
  userId: string,
  jobIds: string[],
  evidenceSnapshotIds: string[],
): Promise<void> {
  const identities: Prisma.EvidenceSnapshotWhereInput[] = [];
  if (jobIds.length > 0) identities.push({ jobId: { in: jobIds } });
  if (evidenceSnapshotIds.length > 0) {
    identities.push({ id: { in: evidenceSnapshotIds } });
  }
  if (identities.length === 0) return;
  await tx.evidenceSnapshot.deleteMany({
    where: {
      userId,
      OR: identities,
      claims: { none: {} },
    },
  });
}

export async function deleteJob(
  userId: string,
  jobId: string,
): Promise<JobDeleteResult> {
  const transactionResult = await prisma.$transaction(
    async (tx) => {
      // Lock is deliberately the first transaction operation. Import takes the
      // same per-user lock before reading tombstones and inserting jobs.
      await acquireJobMutationLock(tx, userId);

      const job = await tx.job.findFirst({
        where: { id: jobId, userId },
        select: { id: true, jobUrl: true },
      });
      if (!job) return null;

      await lockOwnedJobRowsForDeletion(tx, userId, [job.id]);

      const affectedBatchIds = await lockApplicationBatchesForJobDeletion(tx, {
        userId,
        jobIds: [job.id],
      });

      // Generation/autosave/finalize use this same lock. Take it before reading
      // artifact URLs so no committed Blob can appear between read and delete.
      await acquireApplicationMutationLock(tx, userId, job.id);
      const application = await tx.application.findUnique({
        where: { userId_jobId: { userId, jobId: job.id } },
        select: {
          id: true,
          jobId: true,
          resumeTexUrl: true,
          resumePdfUrl: true,
          coverTexUrl: true,
          coverPdfUrl: true,
        },
      });
      const canonicalJobUrl = canonicalizeJobUrl(job.jobUrl);
      await tx.deletedJobUrl.upsert({
        where: { userId_jobUrl: { userId, jobUrl: canonicalJobUrl } },
        update: {},
        create: { userId, jobUrl: canonicalJobUrl },
      });
      const queued = await enqueueApplicationRetirements(
        tx,
        userId,
        application ? [application] : [],
      );
      const evidenceSnapshotIds = await collectEvidenceSnapshotIds(
        tx,
        userId,
        application ? [application.id] : [],
      );
      await tx.application.deleteMany({ where: { userId, jobId: job.id } });
      await deleteUnreferencedEvidence(
        tx,
        userId,
        [job.id],
        evidenceSnapshotIds,
      );
      // deleteMany keeps ownership in the write predicate and remains idempotent
      // if another code path removed the row.
      const deletedJob = await tx.job.deleteMany({
        where: { id: job.id, userId },
      });
      await reconcileApplicationBatchesAfterJobDeletion(tx, {
        userId,
        batchIds: affectedBatchIds,
      });
      return {
        deleted: deletedJob.count > 0,
        queued,
      };
    },
    { timeout: JOB_MUTATION_TRANSACTION_TIMEOUT_MS },
  );

  if (!transactionResult?.deleted) {
    return { alreadyDeleted: true };
  }

  return {
    alreadyDeleted: false,
    ...artifactRetirementResult(transactionResult.queued),
  };
}

export async function batchDeleteJobs(
  userId: string,
  jobIds: string[],
): Promise<BatchDeleteResult> {
  const uniqueJobIds = Array.from(new Set(jobIds));
  if (uniqueJobIds.length === 0) {
    return {
      deleted: 0,
      notFound: 0,
      ...artifactRetirementResult(0),
    };
  }

  const transactionResult = await prisma.$transaction(
    async (tx) => {
      await acquireJobMutationLock(tx, userId);

      const jobs = await tx.job.findMany({
        where: { id: { in: uniqueJobIds }, userId },
        select: { id: true, jobUrl: true },
      });
      if (jobs.length === 0) {
        return { deleted: 0, queued: 0 };
      }

      const foundIds = jobs.map((job) => job.id).sort();
      await lockOwnedJobRowsForDeletion(tx, userId, foundIds);
      const affectedBatchIds = await lockApplicationBatchesForJobDeletion(tx, {
        userId,
        jobIds: foundIds,
      });
      // Fixed order prevents two overlapping batch deletes from waiting on
      // the same application locks in opposite order.
      for (const foundId of foundIds) {
        await acquireApplicationMutationLock(tx, userId, foundId);
      }
      const applications = await tx.application.findMany({
        where: { userId, jobId: { in: foundIds } },
        select: {
          id: true,
          jobId: true,
          resumeTexUrl: true,
          resumePdfUrl: true,
          coverTexUrl: true,
          coverPdfUrl: true,
        },
      });
      const canonicalUrls = jobs.map((job) => canonicalizeJobUrl(job.jobUrl));

      // One tombstone write keeps query count bounded for large selections.
      await tx.deletedJobUrl.createMany({
        data: canonicalUrls.map((jobUrl) => ({ userId, jobUrl })),
        skipDuplicates: true,
      });
      const queued = await enqueueApplicationRetirements(
        tx,
        userId,
        applications,
      );
      const evidenceSnapshotIds = await collectEvidenceSnapshotIds(
        tx,
        userId,
        applications.map((application) => application.id),
      );
      await tx.application.deleteMany({
        where: { userId, jobId: { in: foundIds } },
      });
      await deleteUnreferencedEvidence(
        tx,
        userId,
        foundIds,
        evidenceSnapshotIds,
      );
      const deletedJobs = await tx.job.deleteMany({
        where: { id: { in: foundIds }, userId },
      });
      await reconcileApplicationBatchesAfterJobDeletion(tx, {
        userId,
        batchIds: affectedBatchIds,
      });
      return {
        deleted: deletedJobs.count,
        queued,
      };
    },
    { timeout: JOB_MUTATION_TRANSACTION_TIMEOUT_MS },
  );

  return {
    deleted: transactionResult.deleted,
    notFound: uniqueJobIds.length - transactionResult.deleted,
    ...artifactRetirementResult(transactionResult.queued),
  };
}
