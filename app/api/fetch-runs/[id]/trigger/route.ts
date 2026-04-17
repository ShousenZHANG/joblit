import { NextResponse } from "next/server";
import { requireSession, UnauthorizedError } from "@/lib/server/auth/requireSession";
import type { SessionContext } from "@/lib/server/auth/requireSession";
import { unauthorizedError } from "@/lib/server/api/errorResponse";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import type { Prisma } from "@/lib/generated/prisma";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });
const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function envOrThrow(key: string) {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is not set`);
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
  let session: SessionContext;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
  const { userId } = session;

  const params = await ctx.params;
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_PARAMS" }, { status: 400 });

  const runId = parsed.data.id;
  const idempotencyKey = req.headers.get("Idempotency-Key")?.trim() || null;
  const advisoryKey = runIdToAdvisoryKey(runId);

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
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (txResult.kind === "invalid_state") {
    return NextResponse.json({ error: "INVALID_STATE", status: txResult.status }, { status: 409 });
  }

  // txResult.kind === "locked" — we hold the dispatch slot.
  //
  // CN market: the aggregator pipeline runs in-process (Vercel serverless)
  // via /api/cron/fetch-cn. The GitHub Actions dispatch path + cn-fetch.yml
  // + Python scraper are retired. We just call the cron endpoint directly
  // with CRON_SECRET so it processes this user immediately instead of
  // waiting for the next scheduled sweep.
  //
  // AU market: still dispatches to GitHub Actions (JobSpy pipeline).
  if (txResult.market === "CN") {
    await prisma.fetchRun.updateMany({
      where: { id: runId, userId, status: "QUEUED" },
      data: {
        queries: withDispatchMeta(txResult.queries, {
          inFlightAt: undefined,
          dispatchedAt: new Date().toISOString(),
        }),
      },
    });

    const secret = process.env.CRON_SECRET;
    const webUrl = process.env.JOBLIT_WEB_URL;
    if (secret && webUrl) {
      // Fire-and-forget — the sweep itself updates the FetchRun status.
      fetch(`${webUrl.replace(/\/$/, "")}/api/cron/fetch-cn`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
      }).catch(() => {
        // Cron will still pick it up on next scheduled tick.
      });
    }

    return NextResponse.json({ ok: true });
  }

  const owner = envOrThrow("GITHUB_OWNER");
  const repo = envOrThrow("GITHUB_REPO");
  const token = envOrThrow("GITHUB_TOKEN");
  const workflow = process.env.GITHUB_WORKFLOW_FILE || "jobspy-fetch.yml";
  const ref = process.env.GITHUB_REF || "master";

  const ghRes = await fetch(
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
  );

  if (!ghRes.ok) {
    const text = await ghRes.text().catch(() => "");
    // Best-effort unlock so the user can retry.
    await prisma.fetchRun.updateMany({
      where: { id: runId, userId, status: "QUEUED" },
      data: { queries: txResult.queries as Prisma.InputJsonValue },
    });
    return NextResponse.json(
      { error: "GITHUB_DISPATCH_FAILED", status: ghRes.status, details: text },
      { status: 502 },
    );
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
}
