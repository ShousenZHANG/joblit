import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { canonicalizeJobUrl } from "@/lib/shared/canonicalizeJobUrl";
import { runCnFetch } from "@/lib/server/cnFetch/runCnFetch";
import { scoreSingleJob } from "@/lib/server/jobs/scoreJobs";
import type { CnSource } from "@/lib/server/cnFetch/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Cron-driven CN job fetcher. Replaces the retired GitHub Actions Python
// scraper (tools/fetcher/run_cn_fetcher.py) — see the v2ex / github /
// rsshub adapters in lib/server/cnFetch for the actual source code.
//
// Auth:
//   - Vercel Cron sends Authorization: Bearer $CRON_SECRET automatically
//     when CRON_SECRET is set.
//   - Manual triggers: pass x-cron-secret header with the same value.
//
// Pipeline per user (market="CN" with any FetchRun on record):
//   1. runCnFetch() — calls every enabled source in parallel, normalizes,
//                     dedups across sources.
//   2. Tombstone filter — drop any URL the user previously deleted.
//   3. createMany(skipDuplicates) into Job table (market="CN").
//   4. scoreSingleJob for each newly inserted row against the user's
//      active resume profile.
//   5. Update the user's latest CN FetchRun status + importedCount for UI
//      progress tracking.
//
// Per-user work is wrapped in try/catch so one user's failure does not
// abort the cron sweep.

const USER_SWEEP_CAP = 50;
const USER_DEDUP_WINDOW_MS = 3 * 60 * 60 * 1000; // skip users fetched < 3h ago

interface CnRunConfig {
  queries?: unknown;
  sources?: unknown;
  excludeKeywords?: unknown;
}

function readConfig(raw: unknown): {
  queries: string[];
  sources: CnSource[];
  excludeKeywords: string[];
} {
  const obj = raw && typeof raw === "object" ? (raw as CnRunConfig) : {};
  const queries = Array.isArray(obj.queries)
    ? (obj.queries as unknown[]).filter((q): q is string => typeof q === "string")
    : [];
  const excludeKeywords = Array.isArray(obj.excludeKeywords)
    ? (obj.excludeKeywords as unknown[]).filter(
        (q): q is string => typeof q === "string",
      )
    : [];
  const rawSources = Array.isArray(obj.sources) ? (obj.sources as unknown[]) : [];
  const sources = rawSources.filter(
    (s): s is CnSource => s === "v2ex" || s === "github" || s === "rsshub",
  );
  return {
    queries,
    sources: sources.length > 0 ? sources : ["v2ex", "github"],
    excludeKeywords,
  };
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = request.headers.get("authorization");
  if (bearer === `Bearer ${secret}`) return true;
  const explicit = request.headers.get("x-cron-secret");
  return explicit === secret;
}

interface UserResult {
  userId: string;
  discovered: number;
  imported: number;
  scored: number;
  error?: string;
}

async function processUser(
  userId: string,
  latestRun: { id: string; queries: unknown },
): Promise<UserResult> {
  try {
    const config = readConfig(latestRun.queries);

    await prisma.fetchRun.update({
      where: { id: latestRun.id },
      data: { status: "RUNNING", error: null },
    });

    const result = await runCnFetch({
      sources: config.sources,
      queries: config.queries,
      excludeKeywords: config.excludeKeywords,
    });

    const discovered = result.jobs.length;
    if (discovered === 0) {
      await prisma.fetchRun.update({
        where: { id: latestRun.id },
        data: {
          status: "SUCCEEDED",
          importedCount: 0,
        },
      });
      return { userId, discovered: 0, imported: 0, scored: 0 };
    }

    // Tombstone filter — skip URLs the user previously deleted.
    const deleted = await prisma.deletedJobUrl.findMany({
      where: { userId },
      select: { jobUrl: true },
    });
    const deletedSet = new Set(
      deleted.map((d) => canonicalizeJobUrl(d.jobUrl)),
    );
    const filtered = result.jobs.filter((j) => !deletedSet.has(j.jobUrl));

    // Insert with skipDuplicates. Insert then re-query for which IDs are
    // fresh so we only score new rows (skip rescore for existing).
    const BATCH = 200;
    let imported = 0;
    for (let i = 0; i < filtered.length; i += BATCH) {
      const batch = filtered.slice(i, i + BATCH);
      const res = await prisma.job.createMany({
        data: batch.map((j) => ({
          userId,
          jobUrl: j.jobUrl,
          title: j.title,
          company: j.company,
          location: j.location,
          jobType: j.jobType,
          jobLevel: j.jobLevel,
          description: j.description,
          market: "CN",
          status: "NEW",
        })),
        skipDuplicates: true,
      });
      imported += res.count;
    }

    // Score newly-inserted rows (only those that have matchScore IS NULL —
    // filter lets scoreSingleJob silently no-op when no active profile).
    let scored = 0;
    if (imported > 0) {
      const fresh = await prisma.job.findMany({
        where: {
          userId,
          market: "CN",
          matchScore: null,
          jobUrl: { in: filtered.map((j) => j.jobUrl) },
        },
        select: { id: true },
        take: imported,
      });
      for (const row of fresh) {
        try {
          await scoreSingleJob(userId, row.id);
          scored++;
        } catch {
          // score failures non-fatal — row still usable.
        }
      }
    }

    await prisma.fetchRun.update({
      where: { id: latestRun.id },
      data: {
        status: "SUCCEEDED",
        importedCount: imported,
      },
    });

    return { userId, discovered, imported, scored };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    await prisma.fetchRun
      .update({
        where: { id: latestRun.id },
        data: { status: "FAILED", error: message },
      })
      .catch(() => {});
    return {
      userId,
      discovered: 0,
      imported: 0,
      scored: 0,
      error: message,
    };
  }
}

async function runSweep(): Promise<{
  startedAt: string;
  processed: number;
  skipped: number;
  users: UserResult[];
}> {
  // Pick the most recent CN FetchRun per user. Limit overall work.
  const recentRuns = await prisma.fetchRun.findMany({
    where: { market: "CN" },
    orderBy: { createdAt: "desc" },
    select: { id: true, userId: true, queries: true, createdAt: true },
    take: USER_SWEEP_CAP * 4,
  });

  const latestByUser = new Map<
    string,
    { id: string; queries: unknown; createdAt: Date }
  >();
  for (const r of recentRuns) {
    if (!latestByUser.has(r.userId)) {
      latestByUser.set(r.userId, {
        id: r.id,
        queries: r.queries,
        createdAt: r.createdAt,
      });
    }
  }

  const now = Date.now();
  const results: UserResult[] = [];
  let skipped = 0;
  for (const [userId, run] of latestByUser) {
    if (results.length >= USER_SWEEP_CAP) break;
    if (now - run.createdAt.getTime() < USER_DEDUP_WINDOW_MS) {
      skipped++;
      continue;
    }
    results.push(await processUser(userId, run));
  }

  return {
    startedAt: new Date(now).toISOString(),
    processed: results.length,
    skipped,
    users: results,
  };
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runSweep();
  return NextResponse.json(result);
}

export const POST = GET;
