import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import {
  checkRateLimit,
  rateLimitHeaders,
} from "@/lib/server/api/rateLimit";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import {
  dispatchGithubFetchRun,
  type GithubFetchRunDispatchOutcome,
} from "@/lib/server/fetchRuns/dispatchGithubFetchRun";
import {
  executeInlineFetchRun,
  type InlineFetchRunExecutionOutcome,
} from "@/lib/server/fetchRuns/executeInlineFetchRun";
import {
  claimFetchRunDispatch,
  isInlineTriggerClaim,
  type RejectedTriggerClaim,
  type TriggerClaimRequest,
} from "@/lib/server/fetchRuns/triggerClaim";
import { prisma } from "@/lib/server/prisma";
import { UuidParamSchema } from "@/lib/shared/schemas/common";

export const runtime = "nodejs";
export const maxDuration = 60;

const TRIGGER_RATE_LIMIT = { limit: 30, windowSeconds: 60 } as const;

function rejectedClaimResponse(
  result: RejectedTriggerClaim,
): NextResponse {
  switch (result.kind) {
    case "lock_contended":
    case "already_dispatched":
      return NextResponse.json({ ok: true, alreadyDispatched: true });
    case "idempotent_replay":
      return NextResponse.json({
        ok: true,
        alreadyDispatched: result.alreadyDispatched,
        idempotent: true,
      });
    case "not_found":
      return errorJson("NOT_FOUND", "Not found", 404);
    case "state_changed":
      return errorJson(
        "RUN_NO_LONGER_ACTIVE",
        "The fetch run is no longer active",
        409,
      );
    case "invalid_state":
      return errorJson(
        "INVALID_STATE",
        "The fetch run is not in a state that allows a trigger",
        409,
        { details: { status: result.status } },
      );
  }
}

function inlineExecutionResponse(
  outcome: InlineFetchRunExecutionOutcome,
): NextResponse {
  switch (outcome.kind) {
    case "completed":
      return NextResponse.json({
        ok: true,
        imported: outcome.imported,
        discovered: outcome.discovered,
      });
    case "cancelled":
      return errorJson("RUN_CANCELLED", "The fetch run was cancelled", 409);
    case "superseded":
      return NextResponse.json({ ok: true, alreadyDispatched: true });
    case "no_longer_active":
      return errorJson(
        "RUN_NO_LONGER_ACTIVE",
        "The fetch run is no longer active",
        409,
      );
    case "failed":
      return outcome.market === "GLOBAL"
        ? errorJson("GLOBAL_FETCH_FAILED", "The global fetch failed", 502)
        : errorJson("CN_FETCH_FAILED", "The CN fetch failed", 502);
  }
}

function githubDispatchResponse(
  outcome: GithubFetchRunDispatchOutcome,
): NextResponse {
  switch (outcome.kind) {
    case "completed":
      return NextResponse.json({ ok: true });
    case "not_configured":
      return errorJson(
        "GITHUB_DISPATCH_NOT_CONFIGURED",
        "GitHub dispatch is not configured",
        503,
      );
    case "timeout":
      return errorJson(
        "GITHUB_DISPATCH_TIMEOUT",
        "GitHub dispatch timed out",
        504,
      );
    case "unreachable":
      return errorJson(
        "GITHUB_DISPATCH_UNREACHABLE",
        "GitHub dispatch is unreachable",
        504,
      );
    case "rejected":
      return errorJson(
        "GITHUB_DISPATCH_FAILED",
        "Github dispatch failed",
        502,
      );
  }
}

function triggerRateLimitResponse(userId: string): NextResponse | null {
  const rateLimit = checkRateLimit(
    `fetch-runs:trigger:${userId}`,
    TRIGGER_RATE_LIMIT,
  );
  return rateLimit.allowed
    ? null
    : errorJson(
        "TOO_MANY_TRIGGER_REQUESTS",
        "Too many trigger requests",
        429,
        { headers: rateLimitHeaders(rateLimit) },
      );
}

async function triggerOwnedFetchRun(
  req: Request,
  runId: string,
  userId: string,
): Promise<NextResponse> {
  const rateLimitResponse = triggerRateLimitResponse(userId);
  if (rateLimitResponse) return rateLimitResponse;

  const ownedRun = await prisma.fetchRun.findFirst({
    where: { id: runId, userId },
    select: { id: true },
  });
  if (!ownedRun) return errorJson("NOT_FOUND", "Not found", 404);

  const request: TriggerClaimRequest = {
    runId,
    userId,
    idempotencyKey: req.headers.get("Idempotency-Key")?.trim() || null,
  };
  const claim = await claimFetchRunDispatch(request);
  if (claim.kind !== "locked") return rejectedClaimResponse(claim);
  if (isInlineTriggerClaim(claim)) {
    const outcome = await executeInlineFetchRun(request, claim);
    return inlineExecutionResponse(outcome);
  }
  const outcome = await dispatchGithubFetchRun(request, claim);
  return githubDispatchResponse(outcome);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withSessionRoute(
    ({ userId, params }) =>
      triggerOwnedFetchRun(req, params.id, userId),
    { params: ctx.params, schema: UuidParamSchema },
  );
}
