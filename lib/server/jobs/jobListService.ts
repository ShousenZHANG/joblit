import { prisma } from "@/lib/server/prisma";
import { buildJobsListEtag } from "@/lib/server/jobsListEtag";
import { shouldUseRelevanceSort } from "./searchUtils";
import { listJobsWithRelevance } from "./jobSearchService";

const STATE_LOCATION_MAP = {
  NSW: ["NSW", "New South Wales", "Sydney", "Newcastle", "Wollongong"],
  VIC: ["VIC", "Victoria", "Melbourne", "Geelong"],
  QLD: ["QLD", "Queensland", "Brisbane", "Gold Coast", "Sunshine Coast"],
  WA: ["WA", "Western Australia", "Perth"],
  SA: ["SA", "South Australia", "Adelaide"],
  ACT: ["ACT", "Australian Capital Territory", "Canberra"],
  TAS: ["TAS", "Tasmania", "Hobart"],
  NT: ["NT", "Northern Territory", "Darwin"],
} as const;
type StateKey = keyof typeof STATE_LOCATION_MAP;

export type JobListQuery = {
  limit: number;
  cursor?: string;
  status?: "NEW" | "APPLIED" | "REJECTED";
  q?: string;
  location?: string;
  jobLevel?: string;
  sort: "newest" | "oldest";
  market?: "AU" | "CN";
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
  status: string;
  createdAt: Date;
  updatedAt: Date;
  market: string | null;
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
    if (location.startsWith("state:")) {
      const stateKey = location.replace("state:", "") as StateKey;
      const locationFilters = stateKey in STATE_LOCATION_MAP ? STATE_LOCATION_MAP[stateKey] : null;
      if (locationFilters?.length) {
        andClauses.push({
          OR: locationFilters.map((loc) => ({
            location: { contains: loc, mode: "insensitive" },
          })),
        });
      }
      // Unknown state code → omit location filter (don't search for literal "state:XXX")
    } else {
      andClauses.push({ location: { contains: location, mode: "insensitive" } });
    }
  }

  if (jobLevel) {
    andClauses.push({ jobLevel: { equals: jobLevel, mode: "insensitive" } });
  }

  return {
    userId,
    ...(status ? { status } : {}),
    ...(market ? { market } : {}),
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
    sort === "oldest"
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
        status: true,
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
