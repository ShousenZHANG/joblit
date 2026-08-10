import type { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/server/prisma";

export const DEFAULT_APPLICATION_BATCH_LIMIT = 100;
export const MAX_APPLICATION_BATCH_LIMIT = 200;

type BatchEligibilityClient = Prisma.TransactionClient | typeof prisma;

export function boundedApplicationBatchLimit(
  limit: number | undefined,
): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_APPLICATION_BATCH_LIMIT;
  }
  return Math.min(Math.max(Math.floor(limit), 1), MAX_APPLICATION_BATCH_LIMIT);
}

export async function hasAuMasterResumeProfile(
  client: BatchEligibilityClient,
  userId: string,
): Promise<boolean> {
  const profile = await client.resumeProfile.findFirst({
    where: { userId, locale: "en-AU" },
    select: { id: true },
  });
  return Boolean(profile);
}
