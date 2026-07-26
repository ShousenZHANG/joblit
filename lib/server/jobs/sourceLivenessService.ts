import { prisma } from "@/lib/server/prisma";
import type { Prisma } from "@/lib/generated/prisma";
import { canonicalizeJobUrl } from "@/lib/shared/canonicalizeJobUrl";
import type { SourceDiagnostic } from "@/lib/server/sources/runSourceFetch";
import type { RawSourceJob } from "@/lib/server/sources/types";
import {
  classifyJobLiveness,
  toPersistedJobLivenessStatus,
} from "./jobLiveness";

const URL_BATCH_SIZE = 500;
const LIVENESS_TRANSACTION_TIMEOUT_MS = 30_000;

interface SourceLivenessContext {
  userId: string;
  source: string;
  urls: string[];
  checkedAt: Date;
  missingStatus: ReturnType<typeof toPersistedJobLivenessStatus>;
  missingReason: string;
}

async function markSeenJobsActive(
  tx: Prisma.TransactionClient,
  context: SourceLivenessContext,
): Promise<void> {
  for (let index = 0; index < context.urls.length; index += URL_BATCH_SIZE) {
    await tx.job.updateMany({
      where: {
        userId: context.userId,
        source: context.source,
        jobUrl: { in: context.urls.slice(index, index + URL_BATCH_SIZE) },
        livenessStatus: { not: "EXPIRED" },
        OR: [
          { livenessCheckedAt: null },
          { livenessCheckedAt: { lt: context.checkedAt } },
        ],
      },
      data: {
        livenessStatus: "ACTIVE",
        livenessReason: "source_feed_reachable",
        livenessCheckedAt: context.checkedAt,
        lastSeenAt: context.checkedAt,
      },
    });
  }
}

async function markMissingJobsUncertain(
  tx: Prisma.TransactionClient,
  context: SourceLivenessContext,
): Promise<void> {
  // Seen rows were advanced first. Their checkedAt now equals this snapshot,
  // so the strict guard excludes them without an unbounded NOT IN list.
  await tx.job.updateMany({
    where: {
      userId: context.userId,
      source: context.source,
      livenessStatus: "ACTIVE",
      OR: [
        { livenessCheckedAt: null },
        { livenessCheckedAt: { lt: context.checkedAt } },
      ],
    },
    data: {
      livenessStatus: context.missingStatus,
      livenessReason: context.missingReason,
      livenessCheckedAt: context.checkedAt,
    },
  });
}

async function reconcileSourceLiveness(
  tx: Prisma.TransactionClient,
  context: SourceLivenessContext,
): Promise<void> {
  await markSeenJobsActive(tx, context);
  await markMissingJobsUncertain(tx, context);
}

function successfulSourceIds(
  diagnostics: readonly SourceDiagnostic[],
): string[] {
  return [
    ...new Set(
      diagnostics
        .filter((diagnostic) => diagnostic.ok)
        .map((diagnostic) => diagnostic.source),
    ),
  ].sort();
}

function seenUrlsBySource(
  sources: readonly string[],
  jobs: readonly RawSourceJob[],
): Map<string, Set<string>> {
  const seen = new Map(sources.map((source) => [source, new Set<string>()]));
  for (const job of jobs) {
    const sourceUrls = seen.get(job.source);
    if (!sourceUrls) continue;
    const canonical = canonicalizeJobUrl(job.jobUrl);
    if (canonical) sourceUrls.add(canonical);
  }
  return seen;
}

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
  const successfulSources = successfulSourceIds(options.diagnostics);
  if (!successfulSources.length) return;

  const checkedAt = options.checkedAt ?? new Date();
  const missing = classifyJobLiveness({
    requestedUrl: "https://source-feed.invalid/",
    seenInSourceFeed: false,
    checkedAt: checkedAt.toISOString(),
  });
  const seenBySource = seenUrlsBySource(successfulSources, options.jobs);

  await prisma.$transaction(
    async (tx) => {
      for (const source of successfulSources) {
        await reconcileSourceLiveness(tx, {
          userId: options.userId,
          source,
          urls: [...(seenBySource.get(source) ?? [])],
          checkedAt,
          missingStatus: toPersistedJobLivenessStatus(missing.status),
          missingReason: missing.reason,
        });
      }
    },
    { maxWait: 5_000, timeout: LIVENESS_TRANSACTION_TIMEOUT_MS },
  );
}
