import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import type { FetchRunStatus } from "@/lib/generated/prisma";
import { constantTimeEqual } from "@/lib/server/auth/constantTimeEqual";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });
const BodySchema = z.object({
  status: z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"]).optional(),
  importedCount: z.number().int().min(0).optional(),
  error: z.string().optional().nullable(),
});

const CANCELLED_ERROR = "Cancelled by user";

function requireSecret(req: Request) {
  const expected = process.env.FETCH_RUN_SECRET;
  if (!expected) throw new Error("FETCH_RUN_SECRET is not set");
  const got = req.headers.get("x-fetch-run-secret");
  return constantTimeEqual(got, expected);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!requireSecret(req)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const params = await ctx.params;
  const parsedParams = ParamsSchema.safeParse(params);
  if (!parsedParams.success) return NextResponse.json({ error: "INVALID_PARAMS" }, { status: 400 });

  const json = await req.json().catch(() => null);
  const parsedBody = BodySchema.safeParse(json);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "INVALID_BODY", details: parsedBody.error.flatten() },
      { status: 400 },
    );
  }

  const current = await prisma.fetchRun.findUnique({
    where: { id: parsedParams.data.id },
    select: { id: true, status: true, error: true, importedCount: true },
  });

  if (!current) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const incoming = parsedBody.data;
  const nextImportedCount =
    incoming.importedCount === undefined
      ? current.importedCount
      : Math.max(current.importedCount, incoming.importedCount);

  const isCancelled = current.status === "FAILED" && current.error === CANCELLED_ERROR;
  const isSucceeded = current.status === "SUCCEEDED";

  let nextStatus = current.status;
  let nextError = current.error ?? null;

  // Terminal states are immutable for status/error.
  if (isSucceeded) {
    // Keep status/error, allow importedCount monotonic bump only.
  } else if (isCancelled) {
    nextStatus = "FAILED";
    nextError = CANCELLED_ERROR;
  } else {
    if (incoming.status) {
      const requested = incoming.status;
      if (current.status === "QUEUED") {
        if (requested === "RUNNING" || requested === "FAILED") nextStatus = requested;
      } else if (current.status === "RUNNING") {
        if (requested === "RUNNING" || requested === "SUCCEEDED" || requested === "FAILED") {
          nextStatus = requested;
        }
      } else if (current.status === "FAILED") {
        // keep terminal FAILED
      }
    }

    if (incoming.error !== undefined) {
      // Only FAILED runs should carry an error message; allow clearing on non-failed runs.
      if (nextStatus === "FAILED") nextError = incoming.error ?? null;
      if (nextStatus !== "FAILED" && incoming.error === null) nextError = null;
    } else if (nextStatus !== "FAILED" && nextError) {
      // Clear stale error if worker transitions back to non-failed state.
      nextError = null;
    }
  }

  const patch: { status?: FetchRunStatus; error?: string | null; importedCount?: number } = {};
  if (nextImportedCount !== current.importedCount) patch.importedCount = nextImportedCount;
  if (nextStatus !== current.status && nextStatus) patch.status = nextStatus;
  if ((current.error ?? null) !== nextError) patch.error = nextError;

  if (Object.keys(patch).length) {
    await prisma.fetchRun.update({
      where: { id: current.id },
      data: patch,
    });
  }

  return NextResponse.json({ ok: true });
}

