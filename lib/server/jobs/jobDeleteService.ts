import { del } from "@vercel/blob";
import { prisma } from "@/lib/server/prisma";
import { canonicalizeJobUrl } from "@/lib/shared/canonicalizeJobUrl";

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
  const job = await prisma.job.findFirst({
    where: { id: jobId, userId },
    select: { id: true, jobUrl: true },
  });

  if (!job) {
    return { alreadyDeleted: true };
  }

  const application = await prisma.application.findUnique({
    where: { userId_jobId: { userId, jobId: job.id } },
    select: {
      resumeTexUrl: true,
      resumePdfUrl: true,
      coverTexUrl: true,
      coverPdfUrl: true,
    },
  });

  const canonicalJobUrl = canonicalizeJobUrl(job.jobUrl);
  const transactionResult = await prisma.$transaction([
    prisma.deletedJobUrl.upsert({
      where: { userId_jobUrl: { userId, jobUrl: canonicalJobUrl } },
      update: {},
      create: { userId, jobUrl: canonicalJobUrl },
    }),
    prisma.application.deleteMany({ where: { userId, jobId: job.id } }),
    // deleteMany makes a raced second DELETE idempotent and keeps ownership in
    // the write predicate. job.delete({ id }) could throw P2025 after lookup.
    prisma.job.deleteMany({ where: { id: job.id, userId } }),
  ]);
  const deletedJob = transactionResult[2];
  if (!("count" in deletedJob) || deletedJob.count === 0) {
    return { alreadyDeleted: true };
  }

  const artifactUrls = Array.from(
    new Set(
      [
        application?.resumeTexUrl,
        application?.resumePdfUrl,
        application?.coverTexUrl,
        application?.coverPdfUrl,
      ].filter((value): value is string => typeof value === "string" && value.trim().length > 0),
    ),
  );

  return {
    alreadyDeleted: false,
    blobCleanup: await cleanupArtifacts(artifactUrls),
  };
}

export async function batchDeleteJobs(
  userId: string,
  jobIds: string[],
): Promise<BatchDeleteResult> {
  const uniqueJobIds = Array.from(new Set(jobIds));
  const jobs = await prisma.job.findMany({
    where: { id: { in: uniqueJobIds }, userId },
    select: { id: true, jobUrl: true },
  });

  if (jobs.length === 0) {
    return { deleted: 0, notFound: uniqueJobIds.length, blobCleanup: { attempted: 0, deleted: 0, failed: 0 } };
  }

  const foundIds = jobs.map((j) => j.id);

  const applications = await prisma.application.findMany({
    where: { userId, jobId: { in: foundIds } },
    select: {
      resumeTexUrl: true,
      resumePdfUrl: true,
      coverTexUrl: true,
      coverPdfUrl: true,
    },
  });

  const canonicalUrls = jobs.map((j) => canonicalizeJobUrl(j.jobUrl));

  // Replace N individual upserts with a single createMany(skipDuplicates).
  // Per-batch query count drops from (N + 2) to 3, which keeps the whole
  // transaction comfortably inside Neon's per-statement budget even when
  // a chunk arrives at the absolute MAX_BATCH_SIZE.
  const transactionResult = await prisma.$transaction([
    prisma.deletedJobUrl.createMany({
      data: canonicalUrls.map((url) => ({ userId, jobUrl: url })),
      skipDuplicates: true,
    }),
    prisma.application.deleteMany({ where: { userId, jobId: { in: foundIds } } }),
    prisma.job.deleteMany({ where: { id: { in: foundIds }, userId } }),
  ]);
  const deletedJobs = transactionResult[2];
  const deletedCount = "count" in deletedJobs ? deletedJobs.count : 0;

  const artifactUrls = Array.from(
    new Set(
      applications.flatMap((app) =>
        [app.resumeTexUrl, app.resumePdfUrl, app.coverTexUrl, app.coverPdfUrl]
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0),
      ),
    ),
  );

  return {
    deleted: deletedCount,
    notFound: uniqueJobIds.length - deletedCount,
    blobCleanup: await cleanupArtifacts(artifactUrls),
  };
}
