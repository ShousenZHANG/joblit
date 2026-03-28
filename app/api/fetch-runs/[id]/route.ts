import { NextResponse } from "next/server";
import { requireSession, UnauthorizedError } from "@/lib/server/auth/requireSession";
import type { SessionContext } from "@/lib/server/auth/requireSession";
import { unauthorizedError } from "@/lib/server/api/errorResponse";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });

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

  if (!run) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
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
}

