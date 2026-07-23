import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { UuidParamSchema } from "@/lib/shared/schemas/common";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { constantTimeEqual } from "@/lib/server/auth/constantTimeEqual";

export const runtime = "nodejs";


function requireSecret(req: Request) {
  const expected = process.env.FETCH_RUN_SECRET;
  if (!expected) throw new Error("FETCH_RUN_SECRET is not set");
  const got = req.headers.get("x-fetch-run-secret");
  return constantTimeEqual(got, expected);
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!requireSecret(_req)) {
    return errorJson("UNAUTHORIZED", "Unauthorized", 401);
  }

  const params = await ctx.params;
  const parsed = UuidParamSchema.safeParse(params);
  if (!parsed.success) return errorJson("INVALID_PARAMS", "Invalid route parameters", 400);

  const run = await prisma.fetchRun.findUnique({
    where: { id: parsed.data.id },
    select: {
      id: true,
      userEmail: true,
      status: true,
      error: true,
      importedCount: true,
      queries: true,
      location: true,
      hoursOld: true,
      resultsWanted: true,
      includeFromQueries: true,
      filterDescription: true,
    },
  });
  if (!run) return errorJson("NOT_FOUND", "Not found", 404);

  return NextResponse.json({ run });
}

