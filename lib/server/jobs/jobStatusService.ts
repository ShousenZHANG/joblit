import { prisma } from "@/lib/server/prisma";

type JobStatusUpdateResult = {
  ok: true;
};

export async function updateJobStatus(
  userId: string,
  jobId: string,
  newStatus: "NEW" | "APPLIED" | "REJECTED" | undefined,
): Promise<JobStatusUpdateResult | null> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, userId },
    select: { id: true },
  });

  if (!job) return null;

  if (newStatus) {
    await prisma.job.update({ where: { id: job.id }, data: { status: newStatus } });
  }

  return { ok: true };
}
