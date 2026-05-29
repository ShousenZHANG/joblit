import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { constantTimeEqual } from "@/lib/server/auth/constantTimeEqual";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });

function requireSecret(req: Request) {
  const expected = process.env.FETCH_RUN_SECRET;
  if (!expected) throw new Error("FETCH_RUN_SECRET is not set");
  const got = req.headers.get("x-fetch-run-secret");
  return constantTimeEqual(got, expected);
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!requireSecret(_req)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const params = await ctx.params;
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_PARAMS" }, { status: 400 });

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
  if (!run) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json({ run });
}

