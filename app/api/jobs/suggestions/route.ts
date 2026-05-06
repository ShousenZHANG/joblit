import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { withSessionRoute } from "@/lib/server/api/routeHandler";

export const runtime = "nodejs";

const QuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
});

const FALLBACK_SUGGESTIONS = [
  "Software Engineer",
  "Software Developer",
  "Java Developer",
  "Full Stack Developer",
  "Backend Developer",
  "Frontend Developer",
  "Web Developer",
  "AI Engineer",
  "Machine Learning Engineer",
  "Data Engineer",
  "DevOps Engineer",
  "Cloud Engineer",
  "QA Engineer",
  "Automation Engineer",
  "Mobile Developer",
];

export async function GET(req: Request) {
  return withSessionRoute(async ({ userId }) => {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_QUERY", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const q = parsed.data.q.toLowerCase();

  const recent = await prisma.job.findMany({
    where: {
      userId,
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { company: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { title: true },
    take: 80,
    orderBy: [{ createdAt: "desc" }],
  });

  const fromDb = recent
    .map((row) => row.title)
    .filter(Boolean)
    .map((title) => title.trim())
    .filter(Boolean);

  const combined = Array.from(
    new Set(
      [...fromDb, ...FALLBACK_SUGGESTIONS].filter((title) =>
        title.toLowerCase().includes(q),
      ),
    ),
  ).slice(0, 20);

  const digest = createHash("sha1")
    .update(userId + "::" + q + "::" + combined.join(","))
    .digest("base64url");
  const etag = `W/"sug:${digest}"`;

  const cacheHeaders = {
    ETag: etag,
    "Cache-Control": "private, max-age=60, stale-while-revalidate=120",
  } as const;

  const ifNoneMatch = req.headers.get("if-none-match");
  if (
    ifNoneMatch &&
    ifNoneMatch
      .split(",")
      .map((s) => s.trim())
      .includes(etag)
  ) {
    return new NextResponse(null, { status: 304, headers: cacheHeaders });
  }

  return NextResponse.json({ suggestions: combined }, { headers: cacheHeaders });
  });
}
