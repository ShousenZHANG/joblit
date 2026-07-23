import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { UuidParamSchema } from "@/lib/shared/schemas/common";
import { reportError } from "@/lib/server/observability/errorReporter";
import {
  checkRateLimit,
  rateLimitHeaders,
} from "@/lib/server/api/rateLimit";
import { prisma } from "@/lib/server/prisma";
import type { Prisma } from "@/lib/generated/prisma";
import { processCnFetchRun } from "@/lib/server/cnFetch/processFetchRun";
import { processGlobalFetchRun } from "@/lib/server/sources/processGlobalFetchRun";
import {
  checkFetchRunQuota,
  fetchRunQuotaExceededResponse,
} from "@/lib/server/fetchRuns/fetchRunQuota";
import {
  SafeOutboundError,
  safeOutboundFetch,
} from "@/lib/server/net/safeFetch";

export const runtime = "nodejs";
export const maxDuration = 60;

const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const TRIGGER_RATE_LIMIT = { limit: 30, windowSeconds: 60 } as const;

class MissingDispatchConfigError extends Error {}

function envOrThrow(key: string) {
  const v = process.env[key];
  if (!v) throw new MissingDispatchConfigError(`${key} is not set`);
  return v;
}

type DispatchMeta = {
  inFlightAt?: string;
  dispatchedAt?: string;
  idempotencyKey?: string;
  idempotencyAt?: string;
};

function readDispatchMeta(raw: unknown): DispatchMeta {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const meta = obj.dispatchMeta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  const m = meta as Record<string, unknown>;
  return {
    inFlightAt: typeof m.inFlightAt === "string" ? m.inFlightAt : undefined,
    dispatchedAt: typeof m.dispatchedAt === "string" ? m.dispatchedAt : undefined,
    idempotencyKey: typeof m.idempotencyKey === "string" ? m.idempotencyKey : undefined,
    idempotencyAt: typeof m.idempotencyAt === "string" ? m.idempotencyAt : undefined,
  };
}

function withDispatchMeta(raw: unknown, patch: Partial<DispatchMeta>) {
  const base =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const current = readDispatchMeta(base);
  const next: DispatchMeta = { ...current, ...patch };
  if (!next.inFlightAt) delete next.inFlightAt;
  if (!next.dispatchedAt) delete next.dispatchedAt;
  if (!next.idempotencyKey) delete next.idempotencyKey;
  if (!next.idempotencyAt) delete next.idempotencyAt;

  return {
    ...base,
    dispatchMeta: next,
  };
}

async function failQueuedRun({
  runId,
  userId,
  queries,
  error,
}: {
  runId: string;
  userId: string;
  queries: unknown;
  error: string;
}) {
  await prisma.fetchRun.updateMany({
    where: { id: runId, userId, status: "QUEUED" },
    data: {
      status: "FAILED",
      error,
      queries: queries as Prisma.InputJsonValue,
    },
  });
}

/**
 * Stable 32-bit signed integer hash of a UUID for pg_advisory_xact_lock(bigint).
 * Postgres accepts a 64-bit bigint but also supports a 2-arg form using two
 * 32-bit ints — we use the single-arg form and pass a 31-bit positive value.
 * Collisions across different runIds are acceptable — lock is per-run, worst
 * case is two unrelated runs serializing trigger calls briefly.
 */
function runIdToAdvisoryKey(uuid: string): number {
  // djb2-style hash, masked to 31 bits so it fits a signed 32-bit range
  // and never hits the sign bit (some drivers serialize negative bigints oddly).
  let h = 5381;
  for (let i = 0; i < uuid.length; i++) {
    h = ((h << 5) + h + uuid.charCodeAt(i)) | 0;
  }
  return h & 0x7fffffff;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withSessionRoute(
    async ({ userId, params }) => {
      const runId = params.id;
      const idempotencyKey = req.headers.get("Idempotency-Key")?.trim() || null;
      const advisoryKey = runIdToAdvisoryKey(runId);

      const rateLimit = checkRateLimit(
        `fetch-runs:trigger:${userId}`,
        TRIGGER_RATE_LIMIT,
      );
      if (!rateLimit.allowed) {
        return errorJson("TOO_MANY_TRIGGER_REQUESTS", "Too many trigger requests", 429, {
          headers: rateLimitHeaders(rateLimit),
        });
      }

      // Reject random or cross-tenant UUIDs before entering the global quota
      // critical section. The row is read again under both locks below because a
      // concurrent cancellation or stale expiry can still change its state.
      const ownedRun = await prisma.fetchRun.findFirst({
        where: { id: runId, userId },
        select: { id: true },
      });
      if (!ownedRun) {
        return errorJson("NOT_FOUND", "Not found", 404);
      }

      // Pessimistic lock via Postgres transaction-scoped advisory lock.
      // Only one concurrent trigger per runId can hold this lock; others get
      // LOCK_CONTENDED immediately and return the canonical "alreadyDispatched"
      // response without racing against GitHub.
      const txResult = await prisma.$transaction(async (tx) => {
        const lockRows = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${advisoryKey}::bigint) AS locked
        `;
        if (!lockRows?.[0]?.locked) {
          return { kind: "lock_contended" as const };
        }

        // Quota check also expires abandoned rows under its global lock. Read the
        // target afterwards so an expired target cannot still be dispatched.
        const quotaViolation = await checkFetchRunQuota(tx, userId, "trigger");

        const run = await tx.fetchRun.findFirst({
          where: { id: runId, userId },
          select: { id: true, status: true, market: true, queries: true },
        });
        if (!run) return { kind: "not_found" as const };
        if (run.status !== "QUEUED") {
          return { kind: "invalid_state" as const, status: run.status };
        }

        const meta = readDispatchMeta(run.queries);

        // Idempotency: if caller replays same key within window, return prior result.
        if (idempotencyKey && meta.idempotencyKey === idempotencyKey && meta.idempotencyAt) {
          const ageMs = Date.now() - Date.parse(meta.idempotencyAt);
          if (!Number.isNaN(ageMs) && ageMs < IDEMPOTENCY_WINDOW_MS) {
            return {
              kind: "idempotent_replay" as const,
              alreadyDispatched: Boolean(meta.dispatchedAt || meta.inFlightAt),
            };
          }
        }

        if (meta.dispatchedAt || meta.inFlightAt) {
          return { kind: "already_dispatched" as const };
        }

        if (quotaViolation) return { kind: "quota" as const, quotaViolation };

        // Claim the dispatch slot inside this transaction — row won't change
        // between this update and commit because we hold the advisory lock.
        await tx.fetchRun.update({
          where: { id: runId },
          data: {
            queries: withDispatchMeta(run.queries, {
              inFlightAt: new Date().toISOString(),
              ...(idempotencyKey
                ? {
                    idempotencyKey,
                    idempotencyAt: new Date().toISOString(),
                  }
                : {}),
            }),
          },
        });

        return { kind: "locked" as const, market: run.market, queries: run.queries };
      });

      if (txResult.kind === "lock_contended" || txResult.kind === "already_dispatched") {
        return NextResponse.json({ ok: true, alreadyDispatched: true });
      }
      if (txResult.kind === "idempotent_replay") {
        return NextResponse.json({
          ok: true,
          alreadyDispatched: txResult.alreadyDispatched,
          idempotent: true,
        });
      }
      if (txResult.kind === "not_found") {
        return errorJson("NOT_FOUND", "Not found", 404);
      }
      if (txResult.kind === "invalid_state") {
        return errorJson("INVALID_STATE", "The fetch run is not in a state that allows a trigger", 409, {
          details: { status: txResult.status },
        });
      }
      if (txResult.kind === "quota") {
        return fetchRunQuotaExceededResponse(txResult.quotaViolation);
      }

      // txResult.kind === "locked" — we hold the dispatch slot.
      //
      // CN and GLOBAL markets: the aggregator pipelines run in-process (Vercel
      // serverless). The GitHub Actions dispatch path + cn-fetch.yml + Python
      // scraper are retired, and we no longer hop through an internal request to
      // a background scheduler endpoint (that path silently dropped work when JOBLIT_WEB_URL was
      // unset and left the UI pinned in "Queued"). We run the fetch here and
      // return once it completes; the trigger function has a 60s budget which is
      // ample for the aggregators' typical 5-15s pull.
      //
      // AU market: still dispatches to GitHub Actions (JobSpy pipeline).
      if (txResult.market === "CN" || txResult.market === "GLOBAL") {
        const claimed = await prisma.fetchRun.updateMany({
          where: { id: runId, userId, status: "QUEUED" },
          data: {
            status: "RUNNING",
            error: null,
            queries: withDispatchMeta(txResult.queries, {
              inFlightAt: undefined,
              dispatchedAt: new Date().toISOString(),
            }),
          },
        });
        if (claimed.count === 0) {
          return errorJson("RUN_NO_LONGER_ACTIVE", "The fetch run is no longer active", 409);
        }

        const result =
          txResult.market === "GLOBAL"
            ? await processGlobalFetchRun(userId, {
                id: runId,
                queries: txResult.queries,
              })
            : await processCnFetchRun(userId, {
                id: runId,
                queries: txResult.queries,
              });
        if (result.cancelled) {
          return errorJson("RUN_CANCELLED", "The fetch run was cancelled", 409);
        }
        if (result.error) {
          return NextResponse.json(
            {
              error:
                txResult.market === "GLOBAL"
                  ? "GLOBAL_FETCH_FAILED"
                  : "CN_FETCH_FAILED",
            },
            { status: 502 },
          );
        }
        return NextResponse.json({
          ok: true,
          imported: result.imported,
          discovered: result.discovered,
        });
      }

      // AU market dispatches the JobSpy (LinkedIn) fetcher on GitHub Actions. Seek
      // search moved to the browser extension — there is no server-side Seek
      // pipeline to select anymore.
      // Timeout the dispatch so a hung api.github.com connection can't pin the
      // 60s function budget while holding this run's dispatch slot — every other
      // external call already does this; this one was the gap.
      let ghRes: Response;
      try {
        const owner = envOrThrow("GITHUB_OWNER");
        const repo = envOrThrow("GITHUB_REPO");
        const token = envOrThrow("GITHUB_TOKEN");
        const workflow = process.env.GITHUB_WORKFLOW_FILE || "jobspy-fetch.yml";
        const ref = process.env.GITHUB_REF || "master";
        ghRes = await safeOutboundFetch(
          `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ ref, inputs: { runId } }),
          },
          {
            allowedHosts: ["api.github.com"],
            timeoutMs: 10_000,
            maxResponseBytes: 64 * 1024,
            maxRedirects: 0,
          },
        );
      } catch (err) {
        reportError(err, { scope: "fetch-runs.trigger.dispatch", userId, tags: { runId } });
        const error =
          err instanceof MissingDispatchConfigError
            ? "GITHUB_DISPATCH_NOT_CONFIGURED"
            : err instanceof SafeOutboundError &&
                err.code === "REQUEST_TIMEOUT"
              ? "GITHUB_DISPATCH_TIMEOUT"
              : "GITHUB_DISPATCH_UNREACHABLE";
        await failQueuedRun({
          runId,
          userId,
          queries: txResult.queries,
          error,
        });
        return NextResponse.json(
          { error },
          { status: error === "GITHUB_DISPATCH_NOT_CONFIGURED" ? 503 : 504 },
        );
      }

      if (!ghRes.ok) {
        const text = await ghRes.text().catch(() => "");
        // Upstream detail goes to the error reporter (structured, server-side
        // only) — never forwarded to the client.
        reportError(new Error("GitHub dispatch failed"), {
          scope: "fetch-runs.trigger",
          userId,
          tags: { status: ghRes.status, runId },
          extra: { body: text.slice(0, 500) },
        });
        await failQueuedRun({
          runId,
          userId,
          queries: txResult.queries,
          error: "GITHUB_DISPATCH_FAILED",
        });
        return errorJson("GITHUB_DISPATCH_FAILED", "Github dispatch failed", 502);
      }

      // Mark dispatch complete (still QUEUED until worker starts).
      await prisma.fetchRun.updateMany({
        where: { id: runId, userId, status: "QUEUED" },
        data: {
          queries: withDispatchMeta(txResult.queries, {
            inFlightAt: undefined,
            dispatchedAt: new Date().toISOString(),
          }),
        },
      });

      return NextResponse.json({ ok: true });
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}
