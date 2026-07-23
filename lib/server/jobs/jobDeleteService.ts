import { del } from "@vercel/blob";
import { prisma } from "@/lib/server/prisma";
import { canonicalizeJobUrl } from "@/lib/shared/canonicalizeJobUrl";
import { acquireJobMutationLock } from "@/lib/server/jobs/jobMutationLock";
import { acquireApplicationMutationLock } from "@/lib/server/applications/applicationMutationLock";

type JobDeleteResult =
  | { alreadyDeleted: true }
  | {
      alreadyDeleted: false;
      blobCleanup: { attempted: number; deleted: number; failed: number };
    };

type BatchDeleteResult = {
  deleted: number;
  notFound: number;
  blobCleanup: { attempted: number; deleted: number; failed: number };
};

type BlobCleanupResult = {
  attempted: number;
  deleted: number;
  failed: number;
};

const JOB_MUTATION_TRANSACTION_TIMEOUT_MS = 30_000;

/**
 * Remove the evidence snapshots the deleted Jobs leave behind.
 *
 * Both of `EvidenceSnapshot`'s foreign keys are `SetNull`, and nothing else in
 * the codebase deletes the table, so without this a deleted Job left its
 * extracted JD text and resume claims in Postgres with every non-user key null
 * — unreachable through each index the model declares, and removable only by
 * deleting the account.
 *
 * Two constraints shape this. It must run *after* the Application delete, so
 * the cascaded `ClaimEvidence` edges are already gone, and *before* the Job
 * delete, while `jobId` still identifies the rows. And it must skip snapshots
 * that another Application still cites: ids are content-addressed on
 * `(userId, kind, contentHash)` rather than on the Job, so one row is reused
 * across Jobs whose evidence text matches. Deleting those would hit the
 * `Restrict` on `ClaimEvidence.evidenceSnapshot` and fail the whole delete.
 */
async function deleteUnreferencedEvidence(
  tx: {
    evidenceSnapshot: {
      deleteMany: (args: {
        where: { userId: string; jobId: { in: string[] }; claims: { none: object } };
      }) => Promise<{ count: number }>;
    };
  },
  userId: string,
  jobIds: string[],
): Promise<void> {
  if (jobIds.length === 0) return;
  await tx.evidenceSnapshot.deleteMany({
    where: { userId, jobId: { in: jobIds }, claims: { none: {} } },
  });
}

async function cleanupArtifacts(artifactUrls: string[]): Promise<BlobCleanupResult> {
  const urls = Array.from(
    new Set(artifactUrls.filter((value) => value.trim().length > 0)),
  );
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (urls.length === 0) {
    return { attempted: 0, deleted: 0, failed: 0 };
  }
  if (!blobToken) {
    // Surface deployment misconfiguration instead of reporting a clean
    // no-op while user artifacts remain in storage.
    return { attempted: urls.length, deleted: 0, failed: urls.length };
  }

  // @vercel/blob accepts an array. One request is materially faster than up to
  // four requests per application (and hundreds during a batch delete).
  try {
    await del(urls, { token: blobToken });
    return { attempted: urls.length, deleted: urls.length, failed: 0 };
  } catch {
    // A bulk request can fail because of one malformed/missing object. Retry
    // individually in bounded waves so healthy artifacts are still removed
    // without creating an unbounded burst against Blob.
    let deleted = 0;
    const fallbackChunkSize = 20;
    for (let index = 0; index < urls.length; index += fallbackChunkSize) {
      const results = await Promise.allSettled(
        urls
          .slice(index, index + fallbackChunkSize)
          .map((url) => del(url, { token: blobToken })),
      );
      deleted += results.filter((result) => result.status === "fulfilled").length;
    }
    return {
      attempted: urls.length,
      deleted,
      failed: urls.length - deleted,
    };
  }
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

      // Generation/autosave/finalize use this same lock. Take it before reading
      // artifact URLs so no committed Blob can appear between read and delete.
      await acquireApplicationMutationLock(tx, userId, job.id);
      const application = await tx.application.findUnique({
        where: { userId_jobId: { userId, jobId: job.id } },
        select: {
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
      await tx.application.deleteMany({ where: { userId, jobId: job.id } });
      await deleteUnreferencedEvidence(tx, userId, [job.id]);
      // deleteMany keeps ownership in the write predicate and remains idempotent
      // if another code path removed the row.
      const deletedJob = await tx.job.deleteMany({
        where: { id: job.id, userId },
      });
      return {
        deleted: deletedJob.count > 0,
        artifactUrls: [
          application?.resumeTexUrl,
          application?.resumePdfUrl,
          application?.coverTexUrl,
          application?.coverPdfUrl,
        ].filter(
          (value): value is string =>
            typeof value === "string" && value.trim().length > 0,
        ),
      };
    },
    { timeout: JOB_MUTATION_TRANSACTION_TIMEOUT_MS },
  );

  if (!transactionResult?.deleted) {
    return { alreadyDeleted: true };
  }

  return {
    alreadyDeleted: false,
    blobCleanup: await cleanupArtifacts(transactionResult.artifactUrls),
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
      blobCleanup: { attempted: 0, deleted: 0, failed: 0 },
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
        return { deleted: 0, artifactUrls: [] as string[] };
      }

      const foundIds = jobs.map((job) => job.id).sort();
      // Fixed order prevents two overlapping batch deletes from waiting on
      // the same application locks in opposite order.
      for (const foundId of foundIds) {
        await acquireApplicationMutationLock(tx, userId, foundId);
      }
      const applications = await tx.application.findMany({
        where: { userId, jobId: { in: foundIds } },
        select: {
          resumeTexUrl: true,
          resumePdfUrl: true,
          coverTexUrl: true,
          coverPdfUrl: true,
        },
      });
      const canonicalUrls = jobs.map((job) =>
        canonicalizeJobUrl(job.jobUrl),
      );

      // One tombstone write keeps query count bounded for large selections.
      await tx.deletedJobUrl.createMany({
        data: canonicalUrls.map((jobUrl) => ({ userId, jobUrl })),
        skipDuplicates: true,
      });
      await tx.application.deleteMany({
        where: { userId, jobId: { in: foundIds } },
      });
      await deleteUnreferencedEvidence(tx, userId, foundIds);
      const deletedJobs = await tx.job.deleteMany({
        where: { id: { in: foundIds }, userId },
      });
      return {
        deleted: deletedJobs.count,
        artifactUrls: applications.flatMap((application) =>
          [
            application.resumeTexUrl,
            application.resumePdfUrl,
            application.coverTexUrl,
            application.coverPdfUrl,
          ].filter(
            (value): value is string =>
              typeof value === "string" && value.trim().length > 0,
          ),
        ),
      };
    },
    { timeout: JOB_MUTATION_TRANSACTION_TIMEOUT_MS },
  );

  return {
    deleted: transactionResult.deleted,
    notFound: uniqueJobIds.length - transactionResult.deleted,
    blobCleanup: await cleanupArtifacts(transactionResult.artifactUrls),
  };
}
