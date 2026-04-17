import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requireSession, UnauthorizedError } from "@/lib/server/auth/requireSession";
import type { SessionContext } from "@/lib/server/auth/requireSession";
import { unauthorizedError } from "@/lib/server/api/errorResponse";
import { canonicalizeJobUrl } from "@/lib/shared/canonicalizeJobUrl";
import { listJobs } from "@/lib/server/jobs/jobListService";

export const runtime = "nodejs";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  cursor: z.string().uuid().optional(),
  status: z.enum(["NEW", "APPLIED", "REJECTED"]).optional(),
  q: z.string().trim().min(1).max(80).optional(),
  location: z.string().trim().min(1).max(80).optional(),
  jobLevel: z.string().trim().min(1).max(80).optional(),
  sort: z.enum(["newest", "oldest"]).optional().default("newest"),
  market: z.enum(["AU", "CN"]).optional(),
  platform: z.string().trim().min(1).max(80).optional(),
});

export async function GET(req: Request) {
  let ctx: SessionContext;
  try {
    ctx = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
  const { userId } = ctx;
  const ifNoneMatch = req.headers.get("if-none-match");

  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_QUERY", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await listJobs(userId, parsed.data);

  if (ifNoneMatch && ifNoneMatch === result.etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: result.etag,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  }

  return new NextResponse(
    JSON.stringify({
      items: result.items,
      nextCursor: result.nextCursor,
      totalCount: result.totalCount,
      facets: result.facets,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ETag: result.etag,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    },
  );
}

const CreateSchema = z.object({
  jobUrl: z.string().url(),
  title: z.string().trim().min(1),
  company: z.string().optional(),
  location: z.string().optional(),
  jobType: z.string().optional(),
  jobLevel: z.string().optional(),
  description: z.string().optional(),
});

export async function POST(req: Request) {
  let ctx: SessionContext;
  try {
    ctx = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
  const { userId } = ctx;

  const json = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_BODY", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const jobUrl = canonicalizeJobUrl(parsed.data.jobUrl);
  if (!jobUrl) {
    return NextResponse.json({ error: "INVALID_BODY", details: { jobUrl: ["Invalid URL"] } }, { status: 400 });
  }

  const existing = await prisma.job.findUnique({
    where: { userId_jobUrl: { userId, jobUrl } },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ error: "JOB_URL_EXISTS" }, { status: 409 });
  }

  const created = await prisma.job.create({
    data: {
      userId,
      jobUrl,
      title: parsed.data.title,
      company: parsed.data.company ?? null,
      location: parsed.data.location ?? null,
      jobType: parsed.data.jobType ?? null,
      jobLevel: parsed.data.jobLevel ?? null,
      description: parsed.data.description ?? null,
    },
    select: { id: true },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}

