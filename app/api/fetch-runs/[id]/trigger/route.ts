import { NextResponse } from "next/server";
import { requireSession, UnauthorizedError } from "@/lib/server/auth/requireSession";
import type { SessionContext } from "@/lib/server/auth/requireSession";
import { unauthorizedError } from "@/lib/server/api/errorResponse";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import type { Prisma } from "@/lib/generated/prisma";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });

function envOrThrow(key: string) {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is not set`);
  return v;
}

type DispatchMeta = {
  inFlightAt?: string;
  dispatchedAt?: string;
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

  return {
    ...base,
    dispatchMeta: next,
  };
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
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

  const run = await prisma.fetchRun.findFirst({
    where: { id: parsed.data.id, userId },
    select: { id: true, status: true, market: true, queries: true, updatedAt: true },
  });
  if (!run) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (run.status !== "QUEUED") {
    return NextResponse.json({ error: "INVALID_STATE", status: run.status }, { status: 409 });
  }

  const dispatchMeta = readDispatchMeta(run.queries);
  if (dispatchMeta.dispatchedAt || dispatchMeta.inFlightAt) {
    // Idempotent trigger: already dispatched (or dispatch in flight). Keep QUEUED until worker starts.
    return NextResponse.json({ ok: true, alreadyDispatched: true });
  }

  const owner = envOrThrow("GITHUB_OWNER");
  const repo = envOrThrow("GITHUB_REPO");
  const token = envOrThrow("GITHUB_TOKEN");
  const workflow =
    run.market === "CN"
      ? process.env.GITHUB_CN_WORKFLOW_FILE || "cn-fetch.yml"
      : process.env.GITHUB_WORKFLOW_FILE || "jobspy-fetch.yml";
  const ref = process.env.GITHUB_REF || "master";

  // Take a short-lived lock to prevent double-dispatch. We keep status=QUEUED until the worker reports RUNNING.
  const inFlightAt = new Date().toISOString();
  const lockedQueries = withDispatchMeta(run.queries, { inFlightAt });
  const locked = await prisma.fetchRun.updateMany({
    where: { id: run.id, userId, status: "QUEUED", updatedAt: run.updatedAt },
    data: { queries: lockedQueries },
  });

  if (locked.count === 0) {
    return NextResponse.json({ ok: true, alreadyDispatched: true });
  }

  const ghRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref,
        inputs: {
          runId: run.id,
        },
      }),
    },
  );

  if (!ghRes.ok) {
    const text = await ghRes.text().catch(() => "");
    // Best-effort unlock so the user can retry.
    await prisma.fetchRun.updateMany({
      where: { id: run.id, userId, status: "QUEUED" },
      data: { queries: run.queries as Prisma.InputJsonValue },
    });
    return NextResponse.json(
      { error: "GITHUB_DISPATCH_FAILED", status: ghRes.status, details: text },
      { status: 502 },
    );
  }

  // Mark dispatch complete (still QUEUED until worker starts).
  await prisma.fetchRun.updateMany({
    where: { id: run.id, userId, status: "QUEUED" },
    data: {
      queries: withDispatchMeta(run.queries, {
        inFlightAt: undefined,
        dispatchedAt: new Date().toISOString(),
      }),
    },
  });

  return NextResponse.json({ ok: true });
}

