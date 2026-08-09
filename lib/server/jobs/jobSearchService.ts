import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/server/prisma";
import { buildJobsListEtag } from "@/lib/server/jobsListEtag";
import type { JobListQuery, JobListResult, JobListItem } from "./jobListService";
import { getVisibleJobMarkets } from "./jobMarketScope";
import { normalizePostingRiskFlags } from "./jobListItemMapper";
import { getJobLocationTerms } from "./jobLocationScope";
import { escapeLikePattern } from "./searchUtils";
import { findNearDuplicateJobIds } from "./simHashDuplicateService";

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
  if (market) {
    const visibleMarkets = getVisibleJobMarkets(market).map(
      (value) => Prisma.sql`${value}`,
    );
    conditions.push(
      Prisma.sql`j."market" IN (${Prisma.join(visibleMarkets)})`,
    );
  }
  if (jobLevel) conditions.push(Prisma.sql`LOWER(j."jobLevel") = LOWER(${jobLevel})`);

  const locationTerms = getJobLocationTerms(location);
  if (locationTerms?.length) {
    const locationConditions = locationTerms.map((term) => {
      const pattern = `%${escapeLikePattern(term)}%`;
      return Prisma.sql`j."location" ILIKE ${pattern}`;
    });
    conditions.push(Prisma.sql`(${Prisma.join(locationConditions, " OR ")})`);
  }

  const whereClause = Prisma.join(conditions, " AND ");
  const cursorClause = cursor
    ? Prisma.sql`
        ranked."rowNumber" > COALESCE(
          (
            SELECT cursor_row."rowNumber"
            FROM ranked cursor_row
            WHERE cursor_row."id" = ${cursor}::uuid
          ),
          9223372036854775807
        )
      `
    : Prisma.sql`TRUE`;

  type RawRow = {
    id: string;
    jobUrl: string;
    title: string;
    company: string | null;
    location: string | null;
    jobType: string | null;
    jobLevel: string | null;
    salary: string | null;
    workArrangement: string | null;
    listingDate: Date | null;
    status: string;
    market: string | null;
    source: string | null;
    postingRisk: number | null;
    postingRiskFlags: unknown;
    livenessStatus: "ACTIVE" | "EXPIRED" | "UNCERTAIN";
    livenessReason: string | null;
    possibleDuplicate: boolean;
    descriptionSimHash: string | null;
    createdAt: Date;
    updatedAt: Date;
    resumePdfUrl: string | null;
    resumePdfName: string | null;
    coverPdfUrl: string | null;
  };

  const [rows, countResult] = await Promise.all([
    prisma.$queryRaw<RawRow[]>`
      WITH matched AS (
        SELECT
          j."id", j."jobUrl", j."title", j."company", j."location",
          j."jobType", j."jobLevel", j."salary", j."workArrangement", j."listingDate",
          j."status", j."market", j."source",
          j."postingRisk", j."postingRiskFlags",
          j."livenessStatus", j."livenessReason",
          j."descriptionSimHash",
          (
            j."companyRoleKey" IS NOT NULL
            AND (
              SELECT COUNT(*) > 1
              FROM "Job" duplicate
              WHERE duplicate."userId" = j."userId"
                AND duplicate."companyRoleKey" = j."companyRoleKey"
            )
          ) AS "possibleDuplicate",
          j."createdAt", j."updatedAt",
          a."resumePdfUrl", a."resumePdfName", a."coverPdfUrl",
          GREATEST(
            similarity(LOWER(j."title"), LOWER(${q})),
            similarity(LOWER(COALESCE(j."company", '')), LOWER(${q})),
            similarity(LOWER(COALESCE(j."location", '')), LOWER(${q}))
          ) AS relevance
        FROM "Job" j
        LEFT JOIN LATERAL (
          SELECT "resumePdfUrl", "resumePdfName", "coverPdfUrl"
          FROM "Application"
          WHERE "jobId" = j."id"
          LIMIT 1
        ) a ON true
        WHERE ${whereClause}
      ),
      ranked AS (
        SELECT
          matched.*,
          ROW_NUMBER() OVER (
            ORDER BY relevance DESC, "createdAt" DESC, "id" DESC
          ) AS "rowNumber"
        FROM matched
      )
      SELECT
        ranked."id", ranked."jobUrl", ranked."title", ranked."company",
        ranked."location", ranked."jobType", ranked."jobLevel", ranked."salary",
        ranked."workArrangement", ranked."listingDate", ranked."status",
        ranked."market", ranked."source", ranked."postingRisk",
        ranked."postingRiskFlags", ranked."livenessStatus",
        ranked."livenessReason", ranked."possibleDuplicate",
        ranked."descriptionSimHash",
        ranked."createdAt", ranked."updatedAt",
        ranked."resumePdfUrl", ranked."resumePdfName", ranked."coverPdfUrl"
      FROM ranked
      WHERE ${cursorClause}
      ORDER BY ranked."rowNumber"
      LIMIT ${limit + 1}
    `,
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count FROM "Job" j WHERE ${whereClause}
    `,
  ]);

  const totalCount = Number(countResult[0]?.count ?? 0);
  const hasMore = rows.length > limit;
  const visibleRows = rows.slice(0, limit);
  const simHashDuplicateIds = await findNearDuplicateJobIds(
    userId,
    visibleRows,
  );
  const items: JobListItem[] = visibleRows.map((r) => {
    const { descriptionSimHash: _descriptionSimHash, ...publicFields } = r;
    return {
      ...publicFields,
      possibleDuplicate:
        r.possibleDuplicate || simHashDuplicateIds.has(r.id),
      postingRiskFlags: normalizePostingRiskFlags(r.postingRiskFlags),
      resumePdfUrl: r.resumePdfUrl ?? null,
      resumePdfName: r.resumePdfName ?? null,
      coverPdfUrl: r.coverPdfUrl ?? null,
    };
  });
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
