import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/server/prisma";
import { buildJobsListEtag } from "@/lib/server/jobsListEtag";
import type { JobListQuery, JobListResult, JobListItem } from "./jobListService";
import { escapeLikePattern } from "./searchUtils";

export async function listJobsWithRelevance(
  userId: string,
  query: JobListQuery,
): Promise<JobListResult> {
  const { q, limit, cursor, status, market, location, jobLevel } = query;
  if (!q) throw new Error("listJobsWithRelevance requires q parameter");

  const escaped = escapeLikePattern(q);
  const likePattern = `%${escaped}%`;

  const conditions: Prisma.Sql[] = [
    Prisma.sql`j."userId" = ${userId}::uuid`,
    Prisma.sql`(
      j."title" ILIKE ${likePattern}
      OR j."company" ILIKE ${likePattern}
      OR j."location" ILIKE ${likePattern}
    )`,
  ];

  if (status) conditions.push(Prisma.sql`j."status" = ${status}::"JobStatus"`);
  if (market) conditions.push(Prisma.sql`j."market" = ${market}`);
  if (jobLevel) conditions.push(Prisma.sql`LOWER(j."jobLevel") = LOWER(${jobLevel})`);

  if (location && !location.startsWith("state:")) {
    const locPattern = `%${escapeLikePattern(location)}%`;
    conditions.push(Prisma.sql`j."location" ILIKE ${locPattern}`);
  }

  if (cursor) {
    conditions.push(Prisma.sql`j."id" != ${cursor}::uuid`);
  }

  const whereClause = Prisma.join(conditions, " AND ");

  type RawRow = {
    id: string;
    jobUrl: string;
    title: string;
    company: string | null;
    location: string | null;
    jobType: string | null;
    jobLevel: string | null;
    status: string;
    market: string | null;
    createdAt: Date;
    updatedAt: Date;
    resumePdfUrl: string | null;
    resumePdfName: string | null;
    coverPdfUrl: string | null;
  };

  const [rows, countResult] = await Promise.all([
    prisma.$queryRaw<RawRow[]>`
      SELECT
        j."id", j."jobUrl", j."title", j."company", j."location",
        j."jobType", j."jobLevel", j."status", j."market",
        j."createdAt", j."updatedAt",
        a."resumePdfUrl", a."resumePdfName", a."coverPdfUrl"
      FROM "Job" j
      LEFT JOIN LATERAL (
        SELECT "resumePdfUrl", "resumePdfName", "coverPdfUrl"
        FROM "Application"
        WHERE "jobId" = j."id"
        LIMIT 1
      ) a ON true
      WHERE ${whereClause}
      ORDER BY
        GREATEST(
          similarity(LOWER(j."title"), LOWER(${q})),
          similarity(LOWER(COALESCE(j."company", '')), LOWER(${q})),
          similarity(LOWER(COALESCE(j."location", '')), LOWER(${q}))
        ) DESC,
        j."createdAt" DESC
      LIMIT ${limit + 1}
    `,
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count FROM "Job" j WHERE ${whereClause}
    `,
  ]);

  const totalCount = Number(countResult[0]?.count ?? 0);
  const hasMore = rows.length > limit;
  const items: JobListItem[] = rows.slice(0, limit).map((r) => ({
    ...r,
    resumePdfUrl: r.resumePdfUrl ?? null,
    resumePdfName: r.resumePdfName ?? null,
    coverPdfUrl: r.coverPdfUrl ?? null,
  }));
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

  const jobLevels = Array.from(
    new Set(items.map((j) => j.jobLevel).filter((l): l is string => Boolean(l))),
  );

  const { sort } = query;
  const filtersSignature = [
    `limit=${limit}`,
    `status=${status ?? "ALL"}`,
    `q=${q}`,
    `location=${location ?? ""}`,
    `jobLevel=${jobLevel ?? ""}`,
    `sort=${sort}`,
    `market=${market ?? ""}`,
  ].join("|");

  const etag = buildJobsListEtag({
    userId,
    cursor: cursor ?? null,
    nextCursor,
    filtersSignature,
    jobLevels,
    items: items.map((j) => ({
      id: j.id,
      status: j.status,
      updatedAt: j.updatedAt,
      resumePdfUrl: j.resumePdfUrl,
      resumePdfName: j.resumePdfName,
      coverPdfUrl: j.coverPdfUrl,
    })),
    totalCount,
  });

  return { items, nextCursor, totalCount, etag, facets: { jobLevels } };
}
