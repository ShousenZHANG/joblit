import { prisma } from "@/lib/server/prisma";
import { appendApplicationEvent } from "@/lib/server/career/applicationEvents";
import type { JobStatusValue } from "@/lib/shared/jobStatus";

type JobStatusUpdateResult = {
  ok: true;
};

export async function updateJobStatus(
  userId: string,
  jobId: string,
  newStatus: JobStatusValue | undefined,
): Promise<JobStatusUpdateResult | null> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, userId },
    select: { id: true, status: true },
  });

  if (!job) return null;

  if (newStatus && newStatus !== job.status) {
    await appendApplicationEvent(userId, {
      jobId: job.id,
      type: "STATUS_CHANGED",
      source: "USER",
      toStatus: newStatus,
      expectedFromStatus: job.status,
    });
  }

  return { ok: true };
}
