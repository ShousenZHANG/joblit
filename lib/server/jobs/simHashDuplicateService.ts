import { prisma } from "@/lib/server/prisma";
import { reportError } from "@/lib/server/observability/errorReporter";
import {
  isNearDuplicateSimHash,
  isWithinSimHashWindow,
  SIMHASH_DEFAULT_WINDOW_DAYS,
} from "./simHash";

const MAX_SIMHASH_CANDIDATES = 10_000;

export interface SimHashSeed {
  id: string;
  descriptionSimHash: string | null;
  createdAt: Date;
}

/**
 * Resolve description-level near duplicates for visible list/search rows.
 *
 * The database narrows by user, non-null fingerprint and the shared 90-day
 * window. Hamming comparison stays in TypeScript because PostgreSQL has no
 * portable indexed operation for the persisted hexadecimal fingerprints.
 */
export async function findNearDuplicateJobIds(
  userId: string,
  seeds: readonly SimHashSeed[],
): Promise<Set<string>> {
  const comparableSeeds = seeds.filter(
    (seed): seed is SimHashSeed & { descriptionSimHash: string } =>
      Boolean(seed.descriptionSimHash),
  );
  if (!comparableSeeds.length) return new Set();

  const timestamps = comparableSeeds.map((seed) => seed.createdAt.getTime());
  const windowMs = SIMHASH_DEFAULT_WINDOW_DAYS * 86_400_000;
  const earliest = new Date(Math.min(...timestamps) - windowMs);
  const latest = new Date(Math.max(...timestamps) + windowMs);
  const candidates = await prisma.job.findMany({
    where: {
      userId,
      descriptionSimHash: { not: null },
      createdAt: { gte: earliest, lte: latest },
    },
    select: {
      id: true,
      descriptionSimHash: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_SIMHASH_CANDIDATES + 1,
  });

  if (candidates.length > MAX_SIMHASH_CANDIDATES) {
    reportError(new Error("SimHash duplicate candidate scan truncated"), {
      scope: "jobs.simhash.candidate_limit",
      severity: "warning",
      userId,
      extra: {
        visibleSeeds: comparableSeeds.length,
        candidateLimit: MAX_SIMHASH_CANDIDATES,
      },
    });
  }

  const duplicateIds = new Set<string>();
  for (const seed of comparableSeeds) {
    const duplicate = candidates
      .slice(0, MAX_SIMHASH_CANDIDATES)
      .some(
        (candidate) =>
          candidate.id !== seed.id &&
          candidate.descriptionSimHash !== null &&
          isWithinSimHashWindow(seed.createdAt, candidate.createdAt) &&
          isNearDuplicateSimHash(
            seed.descriptionSimHash,
            candidate.descriptionSimHash,
          ),
      );
    if (duplicate) duplicateIds.add(seed.id);
  }
  return duplicateIds;
}
