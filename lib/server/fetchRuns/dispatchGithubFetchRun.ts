import type { Prisma } from "@/lib/generated/prisma";
import type {
  LockedTriggerClaim,
  TriggerClaimRequest,
} from "@/lib/server/fetchRuns/triggerClaim";
import {
  SafeOutboundError,
  safeOutboundFetch,
} from "@/lib/server/net/safeFetch";
import { reportError } from "@/lib/server/observability/errorReporter";
import { prisma } from "@/lib/server/prisma";
import { getRuntimeCapabilities } from "@/lib/server/runtimeCapabilities";
import { withFetchRunDispatchMeta } from "@/lib/shared/schemas/fetchRunConfig";
import { acquireFetchRunLifecycleLock } from "./fetchRunLifecycleLock";

type GithubDispatchErrorCode =
  | "GITHUB_DISPATCH_NOT_CONFIGURED"
  | "GITHUB_DISPATCH_TIMEOUT"
  | "GITHUB_DISPATCH_UNREACHABLE";

export type GithubFetchRunDispatchOutcome =
  | { kind: "completed" }
  | { kind: "not_configured" }
  | { kind: "timeout" }
  | { kind: "unreachable" }
  | { kind: "rejected" };

class MissingDispatchConfigError extends Error {}

function githubDispatchConfig() {
  const capability = getRuntimeCapabilities().githubFetchRunDispatch;
  if (capability.kind !== "enabled") {
    throw new MissingDispatchConfigError(capability.reason);
  }
  return capability.config;
}

async function sendGithubDispatch(runId: string): Promise<Response> {
  const config = githubDispatchConfig();
  const url =
    `https://api.github.com/repos/${encodeURIComponent(config.owner)}` +
    `/${encodeURIComponent(config.repo)}/actions/workflows/` +
    `${encodeURIComponent(config.workflow)}/dispatches`;
  return safeOutboundFetch(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: config.ref, inputs: { runId } }),
    },
    {
      allowedHosts: ["api.github.com"],
      timeoutMs: 10_000,
      maxResponseBytes: 64 * 1024,
      maxRedirects: 0,
    },
  );
}

function githubDispatchErrorCode(error: unknown): GithubDispatchErrorCode {
  if (error instanceof MissingDispatchConfigError) {
    return "GITHUB_DISPATCH_NOT_CONFIGURED";
  }
  if (
    error instanceof SafeOutboundError &&
    error.code === "REQUEST_TIMEOUT"
  ) {
    return "GITHUB_DISPATCH_TIMEOUT";
  }
  return "GITHUB_DISPATCH_UNREACHABLE";
}

function githubDispatchErrorOutcome(
  errorCode: GithubDispatchErrorCode,
): GithubFetchRunDispatchOutcome {
  switch (errorCode) {
    case "GITHUB_DISPATCH_NOT_CONFIGURED":
      return { kind: "not_configured" };
    case "GITHUB_DISPATCH_TIMEOUT":
      return { kind: "timeout" };
    case "GITHUB_DISPATCH_UNREACHABLE":
      return { kind: "unreachable" };
  }
}

async function failQueuedRun(
  request: TriggerClaimRequest,
  claim: LockedTriggerClaim,
  error: string,
) {
  await prisma.$transaction(async (tx) => {
    await acquireFetchRunLifecycleLock(tx, request.runId);
    await tx.fetchRun.updateMany({
      where: {
        id: request.runId,
        userId: request.userId,
        status: "QUEUED",
      },
      data: {
        status: "FAILED",
        error,
        terminalAt: new Date(),
        queries: claim.queries as Prisma.InputJsonValue,
      },
    });
  });
}

async function dispatchExceptionOutcome(
  error: unknown,
  request: TriggerClaimRequest,
  claim: LockedTriggerClaim,
): Promise<GithubFetchRunDispatchOutcome> {
  reportError(error, {
    scope: "fetch-runs.trigger.dispatch",
    userId: request.userId,
    tags: { runId: request.runId },
  });
  const errorCode = githubDispatchErrorCode(error);
  await failQueuedRun(request, claim, errorCode);
  return githubDispatchErrorOutcome(errorCode);
}

async function rejectedDispatchOutcome(
  response: Response,
  request: TriggerClaimRequest,
  claim: LockedTriggerClaim,
): Promise<GithubFetchRunDispatchOutcome> {
  const text = await response.text().catch(() => "");
  reportError(new Error("GitHub dispatch failed"), {
    scope: "fetch-runs.trigger",
    userId: request.userId,
    tags: { status: response.status, runId: request.runId },
    extra: { body: text.slice(0, 500) },
  });
  await failQueuedRun(
    request,
    claim,
    "GITHUB_DISPATCH_FAILED",
  );
  return { kind: "rejected" };
}

async function markGithubDispatchComplete(
  request: TriggerClaimRequest,
  claim: LockedTriggerClaim,
) {
  await prisma.fetchRun.updateMany({
    where: {
      id: request.runId,
      userId: request.userId,
      status: "QUEUED",
    },
    data: {
      queries: withFetchRunDispatchMeta(claim.claimedQueries, {
        inFlightAt: undefined,
        dispatchedAt: new Date().toISOString(),
      }) as Prisma.InputJsonValue,
    },
  });
}

export async function dispatchGithubFetchRun(
  request: TriggerClaimRequest,
  claim: LockedTriggerClaim,
): Promise<GithubFetchRunDispatchOutcome> {
  let response: Response;
  try {
    response = await sendGithubDispatch(request.runId);
  } catch (error) {
    return dispatchExceptionOutcome(error, request, claim);
  }
  if (!response.ok) {
    return rejectedDispatchOutcome(response, request, claim);
  }
  await markGithubDispatchComplete(request, claim);
  return { kind: "completed" };
}
