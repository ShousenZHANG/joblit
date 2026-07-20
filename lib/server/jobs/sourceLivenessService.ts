import { prisma } from "@/lib/server/prisma";
import { canonicalizeJobUrl } from "@/lib/shared/canonicalizeJobUrl";
import type { SourceDiagnostic } from "@/lib/server/sources/runSourceFetch";
import type { RawSourceJob } from "@/lib/server/sources/types";
import {
  classifyJobLiveness,
  toPersistedJobLivenessStatus,
} from "./jobLiveness";

const URL_BATCH_SIZE = 500;
const LIVENESS_TRANSACTION_TIMEOUT_MS = 30_000;

/**
 * Consume a successful full-source observation.
 *
 * Missing rows are deliberately UNCERTAIN, never EXPIRED: public feeds can
 * paginate or temporarily omit postings. Rows that are still present become
 * ACTIVE and refresh lastSeenAt even when the current user's title filter
 * excludes them from import.
 */
export async function reconcileFetchedSourceJobLiveness(options: {
  userId: string;
  diagnostics: readonly SourceDiagnostic[];
  jobs: readonly RawSourceJob[];
  checkedAt?: Date;
}): Promise<void> {
  const successfulSources = [
    ...new Set(
      options.diagnostics
        .filter((diagnostic) => diagnostic.ok)
        .map((diagnostic) => diagnostic.source),
    ),
  ].sort();
  if (!successfulSources.length) return;

  const checkedAt = options.checkedAt ?? new Date();
  const missing = classifyJobLiveness({
    requestedUrl: "https://source-feed.invalid/",
    seenInSourceFeed: false,
    checkedAt: checkedAt.toISOString(),
  });
  const seenBySource = new Map<string, Set<string>>();
  for (const source of successfulSources) seenBySource.set(source, new Set());
  for (const job of options.jobs) {
    const seen = seenBySource.get(job.source);
    if (!seen) continue;
    const canonical = canonicalizeJobUrl(job.jobUrl);
    if (canonical) seen.add(canonical);
  }

  await prisma.$transaction(
    async (tx) => {
      for (const source of successfulSources) {
        await tx.job.updateMany({
          where: {
            userId: options.userId,
            source,
            livenessStatus: "ACTIVE",
          },
          data: {
            livenessStatus: toPersistedJobLivenessStatus(missing.status),
            livenessReason: missing.reason,
            livenessCheckedAt: checkedAt,
          },
        });

        const urls = [...(seenBySource.get(source) ?? [])];
        for (let index = 0; index < urls.length; index += URL_BATCH_SIZE) {
          await tx.job.updateMany({
            where: {
              userId: options.userId,
              source,
              jobUrl: { in: urls.slice(index, index + URL_BATCH_SIZE) },
              livenessStatus: { not: "EXPIRED" },
            },
            data: {
              livenessStatus: "ACTIVE",
              livenessReason: "source_feed_reachable",
              livenessCheckedAt: checkedAt,
              lastSeenAt: checkedAt,
            },
          });
        }
      }
    },
    { maxWait: 5_000, timeout: LIVENESS_TRANSACTION_TIMEOUT_MS },
  );
}
