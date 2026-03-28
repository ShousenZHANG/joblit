import { del } from "@vercel/blob";
import { prisma } from "@/lib/server/prisma";
import { canonicalizeJobUrl } from "@/lib/shared/canonicalizeJobUrl";

export type JobDeleteResult =
  | { alreadyDeleted: true }
  | {
      alreadyDeleted: false;
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
  if (process.env.BLOB_READ_WRITE_TOKEN && artifactUrls.length > 0) {
    const cleanup = await Promise.allSettled(
      artifactUrls.map((url) => del(url, { token: process.env.BLOB_READ_WRITE_TOKEN })),
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
