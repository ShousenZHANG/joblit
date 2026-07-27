import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { UuidParamSchema } from "@/lib/shared/schemas/common";
import { prisma } from "@/lib/server/prisma";
import {
  FETCH_RUN_STALE_ERROR,
  fetchRunStaleCutoff,
} from "@/lib/server/fetchRuns/fetchRunStale";
import {
  FETCH_RUN_COMMIT_PROTOCOL,
  FetchRunCommitError,
  commitFetchRun,
} from "@/lib/server/fetchRuns/fetchRunCommit";
import type { Prisma } from "@/lib/generated/prisma";

export const runtime = "nodejs";

const FETCH_RUN_STATUS_SELECT = {
  id: true,
  status: true,
  importedCount: true,
  error: true,
  queries: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FetchRunSelect;

type FetchRunStatusRow = Prisma.FetchRunGetPayload<{
  select: typeof FETCH_RUN_STATUS_SELECT;
}>;

function normalizeQueryTerms(raw: unknown) {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };

  if (Array.isArray(raw)) {
    raw.forEach(push);
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.queries)) {
      obj.queries.forEach(push);
    }
    push(obj.title);
  }

  return out;
}

function resolveTitle(raw: unknown, terms: string[]) {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.title === "string" && obj.title.trim()) {
      return obj.title.trim();
    }
  }
  return terms[0] ?? null;
}

function resolveSmartExpand(raw: unknown) {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.smartExpand === "boolean") {
      return obj.smartExpand;
    }
  }
  return true;
}

function isStaleActiveRun(run: FetchRunStatusRow, cutoff: Date): boolean {
  return (
    (run.status === "QUEUED" || run.status === "RUNNING") &&
    run.updatedAt < cutoff
  );
}

async function readFetchRunStatus(
  userId: string,
  runId: string,
): Promise<FetchRunStatusRow | null> {
  return prisma.fetchRun.findFirst({
    where: { id: runId, userId },
    select: FETCH_RUN_STATUS_SELECT,
  });
}

function isExpectedRecoveryRace(error: unknown): boolean {
  return (
    error instanceof FetchRunCommitError &&
    (error.code === "RUN_CANCELLED" || error.code === "RUN_NOT_FOUND")
  );
}

async function recoverStaleFetchRun(
  userId: string,
  run: FetchRunStatusRow,
  staleBefore: Date,
): Promise<FetchRunStatusRow | null> {
  try {
    await commitFetchRun({
      protocol: FETCH_RUN_COMMIT_PROTOCOL,
      command: "fail",
      runId: run.id,
      error: FETCH_RUN_STALE_ERROR,
      staleBefore,
    });
  } catch (error) {
    if (!isExpectedRecoveryRace(error)) throw error;
  }
  return readFetchRunStatus(userId, run.id);
}

function statusResponse(run: FetchRunStatusRow): NextResponse {
  const queryTerms = normalizeQueryTerms(run.queries);
  return NextResponse.json({
    run: {
      id: run.id,
      status: run.status,
      importedCount: run.importedCount,
      error: run.error,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      queryTitle: resolveTitle(run.queries, queryTerms),
      queryTerms,
      smartExpand: resolveSmartExpand(run.queries),
    },
  });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withSessionRoute(
    async ({ userId, params }) => {
      let run = await readFetchRunStatus(userId, params.id);
      if (!run) return errorJson("NOT_FOUND", "Not found", 404);
      const staleCutoff = fetchRunStaleCutoff();
      if (isStaleActiveRun(run, staleCutoff)) {
        // Polling self-heals through the same FRUN-locked state transition as
        // every worker failure. If a batch committed after this snapshot, the
        // run becomes PARTIAL; if completion won the lock, it stays terminal.
        run = await recoverStaleFetchRun(userId, run, staleCutoff);
        if (!run) return errorJson("NOT_FOUND", "Not found", 404);
      }
      return statusResponse(run);
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}

