import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { UuidParamSchema } from "@/lib/shared/schemas/common";
import { prisma } from "@/lib/server/prisma";
import { acquireFetchRunLifecycleLock } from "@/lib/server/fetchRuns/fetchRunLifecycleLock";
import type { FetchRunStatus, Prisma } from "@/lib/generated/prisma";

export const runtime = "nodejs";

type CancelResult =
  | { kind: "not_found" }
  | { kind: "finished"; status: FetchRunStatus }
  | { kind: "cancelled"; status: FetchRunStatus };

function isTerminal(status: FetchRunStatus): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "PARTIAL";
}

async function cancelLockedFetchRun(
  tx: Prisma.TransactionClient,
  userId: string,
  runId: string,
): Promise<CancelResult> {
  await acquireFetchRunLifecycleLock(tx, runId);
  const run = await tx.fetchRun.findFirst({
    where: { id: runId, userId },
    select: { id: true, status: true, commitStartedAt: true },
  });
  if (!run) return { kind: "not_found" };
  if (isTerminal(run.status)) {
    return { kind: "finished", status: run.status };
  }

  // Receipt-backed work stays durable, so cancelling after the first commit is
  // projected honestly as PARTIAL instead of pretending Jobs were rolled back.
  const status: FetchRunStatus = run.commitStartedAt ? "PARTIAL" : "FAILED";
  const cancelled = await tx.fetchRun.updateMany({
    where: { id: run.id, userId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status, error: "Cancelled by user", terminalAt: new Date() },
  });
  if (cancelled.count > 0) return { kind: "cancelled", status };

  const current = await tx.fetchRun.findFirst({
    where: { id: run.id, userId },
    select: { status: true },
  });
  return { kind: "finished", status: current?.status ?? "FAILED" };
}

function cancelResultResponse(result: CancelResult): NextResponse {
  if (result.kind === "not_found") {
    return errorJson("NOT_FOUND", "Not found", 404);
  }
  if (result.kind === "finished") {
    return errorJson("ALREADY_FINISHED", "The fetch run already finished", 409, {
      details: { status: result.status },
    });
  }
  return NextResponse.json({ ok: true, status: result.status });
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withSessionRoute(
    async ({ userId, params }) => {
      const result = await prisma.$transaction(
        (tx) => cancelLockedFetchRun(tx, userId, params.id),
        { timeout: 30_000 },
      );
      return cancelResultResponse(result);
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}
