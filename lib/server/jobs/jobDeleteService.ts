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
  await prisma.$transaction([
    prisma.deletedJobUrl.upsert({
      where: { userId_jobUrl: { userId, jobUrl: canonicalJobUrl } },
      update: {},
      create: { userId, jobUrl: canonicalJobUrl },
    }),
    prisma.application.deleteMany({ where: { userId, jobId: job.id } }),
    prisma.job.delete({ where: { id: job.id } }),
  ]);

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

  let blobCleanupFailed = 0;
  let blobCleanupDeleted = 0;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (blobToken && artifactUrls.length > 0) {
    const cleanup = await Promise.allSettled(
      artifactUrls.map((url) => del(url, { token: blobToken })),
    );
    blobCleanupDeleted = cleanup.filter((r) => r.status === "fulfilled").length;
    blobCleanupFailed = cleanup.length - blobCleanupDeleted;
  }

  return {
    alreadyDeleted: false,
    blobCleanup: {
      attempted: artifactUrls.length,
      deleted: blobCleanupDeleted,
      failed: blobCleanupFailed,
    },
  };
}

export async function batchDeleteJobs(
  userId: string,
  jobIds: string[],
): Promise<BatchDeleteResult> {
  const jobs = await prisma.job.findMany({
    where: { id: { in: jobIds }, userId },
    select: { id: true, jobUrl: true },
  });

  if (jobs.length === 0) {
    return { deleted: 0, notFound: jobIds.length, blobCleanup: { attempted: 0, deleted: 0, failed: 0 } };
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
  await prisma.$transaction([
    prisma.deletedJobUrl.createMany({
      data: canonicalUrls.map((url) => ({ userId, jobUrl: url })),
      skipDuplicates: true,
    }),
    prisma.application.deleteMany({ where: { userId, jobId: { in: foundIds } } }),
    prisma.job.deleteMany({ where: { id: { in: foundIds }, userId } }),
  ]);

  const artifactUrls = Array.from(
    new Set(
      applications.flatMap((app) =>
        [app.resumeTexUrl, app.resumePdfUrl, app.coverTexUrl, app.coverPdfUrl]
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0),
      ),
    ),
  );

  let blobCleanupFailed = 0;
  let blobCleanupDeleted = 0;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (blobToken && artifactUrls.length > 0) {
    const cleanup = await Promise.allSettled(
      artifactUrls.map((url) => del(url, { token: blobToken })),
    );
    blobCleanupDeleted = cleanup.filter((r) => r.status === "fulfilled").length;
    blobCleanupFailed = cleanup.length - blobCleanupDeleted;
  }

  return {
    deleted: foundIds.length,
    notFound: jobIds.length - foundIds.length,
    blobCleanup: {
      attempted: artifactUrls.length,
      deleted: blobCleanupDeleted,
      failed: blobCleanupFailed,
    },
  };
}
