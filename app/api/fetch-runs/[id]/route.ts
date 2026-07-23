import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { UuidParamSchema } from "@/lib/shared/schemas/common";
import { prisma } from "@/lib/server/prisma";
import {
  FETCH_RUN_STALE_ERROR,
  fetchRunStaleCutoff,
} from "@/lib/server/fetchRuns/fetchRunQuota";

export const runtime = "nodejs";

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

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withSessionRoute(
    async ({ userId, params }) => {
      let run = await prisma.fetchRun.findFirst({
        where: { id: params.id, userId },
        select: {
          id: true,
          status: true,
          importedCount: true,
          error: true,
          queries: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!run) return errorJson("NOT_FOUND", "Not found", 404);
      const staleCutoff = fetchRunStaleCutoff();
      if (
        (run.status === "QUEUED" || run.status === "RUNNING") &&
        run.updatedAt < staleCutoff
      ) {
        // Polling self-heals this run. Normal polls stay read-only; only a stale
        // active row pays for the guarded write.
        const expired = await prisma.fetchRun.updateMany({
          where: {
            id: run.id,
            userId,
            status: { in: ["QUEUED", "RUNNING"] },
            updatedAt: { lt: staleCutoff },
          },
          data: { status: "FAILED", error: FETCH_RUN_STALE_ERROR },
        });
        if (expired.count > 0) {
          run = {
            ...run,
            status: "FAILED",
            error: FETCH_RUN_STALE_ERROR,
            updatedAt: new Date(),
          };
        }
      }
      const queryTerms = normalizeQueryTerms(run.queries);
      const queryTitle = resolveTitle(run.queries, queryTerms);
      const smartExpand = resolveSmartExpand(run.queries);

      return NextResponse.json({
        run: {
          id: run.id,
          status: run.status,
          importedCount: run.importedCount,
          error: run.error,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
          queryTitle,
          queryTerms,
          smartExpand,
        },
      });
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}

