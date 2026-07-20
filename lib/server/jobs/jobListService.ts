import { prisma } from "@/lib/server/prisma";
import { buildJobsListEtag } from "@/lib/server/jobsListEtag";
import type { Market } from "@/lib/shared/market";
import { shouldUseRelevanceSort } from "./searchUtils";
import { listJobsWithRelevance } from "./jobSearchService";
import { getVisibleJobMarkets } from "./jobMarketScope";
import { normalizePostingRiskFlags } from "./jobListItemMapper";
import { getJobLocationTerms } from "./jobLocationScope";

export type JobListQuery = {
  limit: number;
  cursor?: string;
  status?: "NEW" | "APPLIED" | "REJECTED";
  q?: string;
  location?: string;
  jobLevel?: string;
  sort: "newest" | "oldest" | "fit";
  /** Deterministic verdict bands over Job.fitScore (45/60/75 thresholds). */
  fitBand?: "strong" | "good" | "moderate" | "low" | "unscored";
  /**
   * Locale-backed Jobs workspace. AU includes persisted GLOBAL source rows;
   * CN remains CN-only. GLOBAL is intentionally not a UI Market.
   */
  market?: Market;
  platform?: string;
};

export type JobListItem = {
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
  createdAt: Date;
  updatedAt: Date;
  market: string | null;
  source: string | null;
  postingRisk: number | null;
  postingRiskFlags: string[] | null;
  fitScore: number | null;
  fitVerdict: string | null;
  fitEligibility: string | null;
  resumePdfUrl: string | null;
  resumePdfName: string | null;
  coverPdfUrl: string | null;
};

export type JobListResult = {
  items: JobListItem[];
  nextCursor: string | null;
  totalCount: number;
  etag: string;
  facets: { jobLevels: string[] };
};

type JobWhereClause = Exclude<
  NonNullable<Parameters<typeof prisma.job.findMany>[0]>["where"],
  undefined
>;

function buildWhereClause(userId: string, query: JobListQuery): JobWhereClause {
  const { status, q, location, jobLevel, market } = query;
  const andClauses: JobWhereClause[] = [];

  if (q) {
    andClauses.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { company: { contains: q, mode: "insensitive" } },
        { location: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  if (location) {
    const locationTerms = getJobLocationTerms(location);
    if (locationTerms?.length) {
      andClauses.push({
        OR: locationTerms.map((term) => ({
          location: { contains: term, mode: "insensitive" },
        })),
      });
      // Unknown state code → omit location filter (don't search for literal "state:XXX")
    }
  }

  if (jobLevel) {
    andClauses.push({ jobLevel: { equals: jobLevel, mode: "insensitive" } });
  }

  if (query.fitBand) {
    switch (query.fitBand) {
      case "strong":
        andClauses.push({ fitScore: { gte: 75 } });
        break;
      case "good":
        andClauses.push({ fitScore: { gte: 60, lt: 75 } });
        break;
      case "moderate":
        andClauses.push({ fitScore: { gte: 45, lt: 60 } });
        break;
      case "low":
        andClauses.push({ fitScore: { lt: 45 } });
        break;
      case "unscored":
        andClauses.push({ fitScore: null });
        break;
    }
  }

  return {
    userId,
    ...(status ? { status } : {}),
    ...(market ? { market: { in: getVisibleJobMarkets(market) } } : {}),
    ...(andClauses.length ? { AND: andClauses } : {}),
  };
}

function getCursorPage<T extends { id: string }>(
  items: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  if (limit <= 0) return { items: [], nextCursor: null };
  if (items.length <= limit) return { items, nextCursor: null };
  return {
    items: items.slice(0, limit),
    nextCursor: items[limit - 1]?.id ?? null,
  };
}

export async function listJobs(userId: string, query: JobListQuery): Promise<JobListResult> {
  const { limit, cursor, sort } = query;
  const orderBy =
    sort === "fit"
      ? [
          { fitScore: { sort: "desc" as const, nulls: "last" as const } },
          { createdAt: "desc" as const },
          { id: "desc" as const },
        ]
      : sort === "oldest"
        ? [{ createdAt: "asc" as const }, { id: "asc" as const }]
        : [{ createdAt: "desc" as const }, { id: "desc" as const }];

  const where = buildWhereClause(userId, query);

  if (query.q && shouldUseRelevanceSort(query.q)) {
    return listJobsWithRelevance(userId, query);
  }

  const [jobsWithExtra, totalCount] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        jobUrl: true,
        title: true,
        company: true,
        location: true,
        jobType: true,
        jobLevel: true,
        salary: true,
        workArrangement: true,
        listingDate: true,
        status: true,
        source: true,
        postingRisk: true,
        postingRiskFlags: true,
        fitScore: true,
        fitVerdict: true,
        fitEligibility: true,
        createdAt: true,
        updatedAt: true,
        market: true,
        applications: {
          select: { resumePdfUrl: true, resumePdfName: true, coverPdfUrl: true },
        },
      },
    }),
    prisma.job.count({ where }),
  ]);

  const normalized = jobsWithExtra.map((job) => {
    const { applications, ...rest } = job;
    const application = applications?.[0] ?? null;
    return {
      ...rest,
      postingRiskFlags: normalizePostingRiskFlags(rest.postingRiskFlags),
      resumePdfUrl: application?.resumePdfUrl ?? null,
      resumePdfName: application?.resumePdfName ?? null,
      coverPdfUrl: application?.coverPdfUrl ?? null,
    };
  });

  const { items, nextCursor } = getCursorPage(normalized, limit);

  const jobLevels = Array.from(
    new Set(
      items
        .map((job) => job.jobLevel)
        .filter((level): level is string => Boolean(level)),
    ),
  );

  const filtersSignature = [
    `limit=${limit}`,
    `status=${query.status ?? "ALL"}`,
    `q=${query.q ?? ""}`,
    `location=${query.location ?? ""}`,
    `jobLevel=${query.jobLevel ?? ""}`,
    `sort=${sort}`,
    `fitBand=${query.fitBand ?? ""}`,
    `market=${query.market ?? ""}`,
  ].join("|");

  const etag = buildJobsListEtag({
    userId,
    cursor: cursor ?? null,
    nextCursor,
    filtersSignature,
    jobLevels,
    items: items.map((job) => ({
      id: job.id,
      status: job.status,
      updatedAt: job.updatedAt,
      resumePdfUrl: job.resumePdfUrl ?? null,
      resumePdfName: job.resumePdfName ?? null,
      coverPdfUrl: job.coverPdfUrl ?? null,
    })),
    totalCount,
  });

  return {
    items,
    nextCursor,
    totalCount,
    etag,
    facets: { jobLevels },
  };
}
