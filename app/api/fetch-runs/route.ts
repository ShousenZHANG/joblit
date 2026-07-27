import { NextResponse } from "next/server";
import { TITLE_MATCH_MODES } from "@/lib/shared/jobRelevance";
import { z } from "zod";
import { withSessionRoute, parseJsonValue } from "@/lib/server/api/routeHandler";
import { prisma } from "@/lib/server/prisma";
import { expandRoleQueries } from "@/lib/shared/fetchRolePacks";
import { filterDescriptionExclusionRules } from "@/lib/shared/fetchExclusionCriteria";
import {
  checkFetchRunQuota,
  fetchRunQuotaExceededResponse,
} from "@/lib/server/fetchRuns/fetchRunQuota";
import { ALL_SOURCE_IDS, isKnownSourceId } from "@/lib/server/sources/registry";
import { loadEnabledAtsBoardAdapters } from "@/lib/server/sources/atsBoardStore";
import { MAX_GLOBAL_SOURCES_PER_RUN } from "@/lib/server/sources/limits";
import { reportError } from "@/lib/server/observability/errorReporter";
import {
  buildAuFetchRunConfigV1,
  buildCnFetchRunConfigV1,
  buildGlobalFetchRunConfigV1,
} from "@/lib/shared/schemas/fetchRunConfig";

export const runtime = "nodejs";

// Title exclusions allow any user term (presets + custom). Lower-cased and
// length-bounded; the worker escapes each term before building its regex, so
// arbitrary input is injection-safe.
const TitleExcludeSchema = z.string().trim().toLowerCase().min(1).max(40);
const MAX_AU_QUERIES = 12;
const MAX_AU_QUERY_LENGTH = 120;
const MAX_EXPANDED_AU_QUERIES = 24;
const ATS_SOURCE_ID_RE =
  /^ats:(?:greenhouse|lever|ashby|workable):[a-z0-9][a-z0-9:_-]*$/;

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const AuQuerySchema = z.string().trim().min(1).max(MAX_AU_QUERY_LENGTH);

const queriesField = z
  .union([
    z.array(z.string()),
    z.string().min(1).max(MAX_AU_QUERIES * (MAX_AU_QUERY_LENGTH + 1)),
  ])
  .optional()
  .transform((v) => {
    if (!v) return [];
    if (typeof v === "string") {
      return v
        .split("|")
        .flatMap((chunk) => chunk.split(","))
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return v.map((s) => s.trim()).filter(Boolean);
  })
  .pipe(
    z
      .array(AuQuerySchema)
      .max(MAX_AU_QUERIES)
      .transform(uniqueStrings),
  );

const AUSchema = z
  .object({
    market: z.literal("AU").optional().default("AU"),
    title: z.string().trim().min(1).max(120).optional(),
    queries: queriesField,
    location: z.string().trim().min(1).max(160).optional(),
    hoursOld: z.coerce.number().int().min(1).max(24 * 30).optional(),
    smartExpand: z.coerce.boolean().optional().default(true),
    includeFromQueries: z.coerce.boolean().optional().default(true),
    titleMatch: z.enum(TITLE_MATCH_MODES).optional(),
    applyExcludes: z.coerce.boolean().optional().default(true),
    excludeTitleTerms: z.array(TitleExcludeSchema).max(24).optional().default([]),
    excludeDescriptionRules: z
      .array(z.string())
      .optional()
      .default([])
      .transform(filterDescriptionExclusionRules),
    // Only the JobSpy (LinkedIn) pipeline is server-side now; Seek search moved
    // to the browser extension. Kept as a fixed field so run status lanes and
    // the trigger dispatch keep reading source === "jobspy".
    source: z.literal("jobspy").optional().default("jobspy"),
  })
  .refine((data) => (data.title ?? data.queries?.[0])?.trim(), {
    message: "title is required",
    path: ["title"],
  });

// CN schema v2 — replaces the legacy Boss/Lagou/Liepin/Zhilian scraper path.
// See lib/server/cnFetch/ for the new multi-source aggregator. `platforms`
// is dropped (cookie-auth scrape retired), `city` is dropped (aggregator
// output isn't city-partitioned), salary filters are dropped (handled by
// normalize step). The new knob is `sources`.
const CNSchema = z.object({
  market: z.literal("CN"),
  queries: z
    .array(z.string().trim().min(1).max(120))
    .min(1)
    .max(12)
    .transform(uniqueStrings),
  sources: z
    .array(z.enum(["nowcoder"]))
    .max(1)
    .optional()
    .default(["nowcoder"]),
  excludeKeywords: z
    .array(z.string().trim().min(1).max(40))
    .max(24)
    .optional()
    .default([])
    .transform(uniqueStrings),
  locations: z
    .array(z.string().trim().min(1).max(80))
    .max(12)
    .optional()
    .default([])
    .transform(uniqueStrings),
});

// GLOBAL runs read public aggregator feeds server-side. No queries, no
// location, no GitHub Actions dispatch — the source list is the whole input,
// and the worker completes the run in-process.
const GlobalSchema = z.object({
  market: z.literal("GLOBAL"),
  queries: queriesField.refine((value) => value.length > 0, {
    message: "at least one role query is required",
  }),
  baseQueries: queriesField,
  location: z.string().trim().min(1).max(160).optional(),
  hoursOld: z.coerce.number().int().min(1).max(24 * 30).optional(),
  smartExpand: z.coerce.boolean().optional().default(true),
  includeFromQueries: z.coerce.boolean().optional().default(true),
  titleMatch: z.enum(TITLE_MATCH_MODES).optional(),
  applyExcludes: z.coerce.boolean().optional().default(true),
  excludeTitleTerms: z.array(TitleExcludeSchema).max(24).optional().default([]),
  excludeDescriptionRules: z
    .array(z.string())
    .optional()
    .default([])
    .transform(filterDescriptionExclusionRules),
  sources: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(60)
        .refine(
          (value) => isKnownSourceId(value) || ATS_SOURCE_ID_RE.test(value),
          { message: "unknown source id" },
        ),
    )
    .min(1)
    .max(MAX_GLOBAL_SOURCES_PER_RUN)
    .optional()
    .transform((value) => (value ? uniqueStrings(value) : undefined)),
});

async function resolveGlobalSources(
  requested: readonly string[] | undefined,
  userId: string,
): Promise<
  | { ok: true; sources: string[]; selection: "all" | "explicit" }
  | { ok: false; kind: "unknown"; unknown: string[] }
  | { ok: false; kind: "too_many"; configured: number; limit: number }
> {
  let dynamicIds: string[] = [];
  try {
    const loaded = await loadEnabledAtsBoardAdapters();
    dynamicIds = loaded.adapters.map((adapter) => adapter.id);
    if (loaded.issues.length) {
      reportError(new Error("Invalid ATS board database configuration"), {
        scope: "fetchRuns.sources.database_config",
        severity: "warning",
        userId,
        extra: { issues: loaded.issues },
      });
    }
  } catch (error) {
    // Registry is additive. Core sources remain available during rollout or
    // a transient AtsBoardSource read failure.
    reportError(error, {
      scope: "fetchRuns.sources.load",
      severity: "warning",
      userId,
    });
  }

  if (!requested) {
    const sources = [...new Set([...ALL_SOURCE_IDS, ...dynamicIds])];
    if (sources.length > MAX_GLOBAL_SOURCES_PER_RUN) {
      return {
        ok: false,
        kind: "too_many",
        configured: sources.length,
        limit: MAX_GLOBAL_SOURCES_PER_RUN,
      };
    }
    return {
      ok: true,
      sources,
      selection: "all",
    };
  }
  const dynamic = new Set(dynamicIds);
  const unknown = requested.filter(
    (source) => !isKnownSourceId(source) && !dynamic.has(source),
  );
  return unknown.length
    ? { ok: false, kind: "unknown", unknown }
    : { ok: true, sources: [...requested], selection: "explicit" };
}

export async function GET() {
  return withSessionRoute(async ({ userId }) => {
    const runs = await prisma.fetchRun.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        status: true,
        market: true,
        importedCount: true,
        queries: true,
        location: true,
        hoursOld: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      runs: runs.map((r) => {
        const q = (r.queries ?? {}) as Record<string, unknown>;
        const queryList = Array.isArray(q.queries) ? (q.queries as string[]) : [];
        return {
          id: r.id,
          status: r.status,
          market: r.market ?? "AU",
          importedCount: r.importedCount,
          title: typeof q.title === "string" ? q.title : queryList[0] ?? null,
          queryCount: queryList.length,
          location: r.location,
          hoursOld: r.hoursOld,
          smartExpand: typeof q.smartExpand === "boolean" ? q.smartExpand : null,
          sources: Array.isArray(q.sources) ? (q.sources as string[]) : null,
          source: typeof q.source === "string" ? (q.source as string) : null,
          classification: typeof q.classification === "string" ? (q.classification as string) : null,
          subClassification:
            typeof q.subClassification === "string" ? (q.subClassification as string) : null,
          workType: typeof q.workType === "string" ? (q.workType as string) : null,
          excludeKeywords: Array.isArray(q.excludeKeywords)
            ? (q.excludeKeywords as string[])
            : null,
          createdAt: r.createdAt.toISOString(),
        };
      }),
    });
  });
}

export async function POST(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const json = await req.json().catch(() => null);
    const marketHint =
      json && typeof json === "object" && "market" in json ? json.market : "AU";

    if (marketHint === "CN") {
      const parsed = parseJsonValue(json, CNSchema, requestId);
      if (!parsed.ok) return parsed.response;
      const d = parsed.data;
      const title = d.queries[0] ?? "";
      const txResult = await prisma.$transaction(async (tx) => {
        const quotaViolation = await checkFetchRunQuota(tx, userId, "create");
        if (quotaViolation) return { kind: "quota" as const, quotaViolation };

        const run = await tx.fetchRun.create({
          data: {
            userId,
            status: "QUEUED",
            market: "CN",
            importedCount: 0,
            queries: buildCnFetchRunConfigV1({
              title,
              queries: d.queries,
              sources: d.sources,
              excludeKeywords: d.excludeKeywords,
              locations: d.locations,
            }),
            location: null,
            hoursOld: null,
            resultsWanted: null,
            includeFromQueries: false,
            filterDescription: false,
          },
          select: { id: true },
        });
        return { kind: "created" as const, id: run.id };
      });

      if (txResult.kind === "quota") {
        return fetchRunQuotaExceededResponse(txResult.quotaViolation);
      }
      return NextResponse.json({ id: txResult.id }, { status: 201 });
    }

    if (marketHint === "GLOBAL") {
      const parsed = parseJsonValue(json, GlobalSchema, requestId);
      if (!parsed.ok) return parsed.response;
      const d = parsed.data;
      const sourceSelection = await resolveGlobalSources(d.sources, userId);
      if (!sourceSelection.ok) {
        if (sourceSelection.kind === "too_many") {
          return NextResponse.json(
            {
              error: {
                code: "SOURCE_LIMIT_EXCEEDED",
                message:
                  "Too many sources are enabled for one fetch. Select a smaller source set.",
                details: {
                  configured: sourceSelection.configured,
                  limit: sourceSelection.limit,
                },
              },
              requestId,
            },
            { status: 400 },
          );
        }
        return NextResponse.json(
          {
            error: {
              code: "INVALID_SOURCE",
              message: "One or more sources are unavailable",
              details: { sources: sourceSelection.unknown },
            },
            requestId,
          },
          { status: 400 },
        );
      }
      const baseQueries = d.baseQueries.length > 0 ? d.baseQueries : d.queries;
      const expandedQueries = d.smartExpand
        ? expandRoleQueries(d.queries)
        : d.queries;
      const excludeTitleTerms = d.applyExcludes ? d.excludeTitleTerms : [];
      const excludeDescriptionRules = d.applyExcludes
        ? d.excludeDescriptionRules
        : [];
      const txResult = await prisma.$transaction(async (tx) => {
        const quotaViolation = await checkFetchRunQuota(tx, userId, "create");
        if (quotaViolation) return { kind: "quota" as const, quotaViolation };

        const run = await tx.fetchRun.create({
          data: {
            userId,
            status: "QUEUED",
            market: "GLOBAL",
            importedCount: 0,
            queries: buildGlobalFetchRunConfigV1({
              title: baseQueries[0] ?? d.queries[0],
              baseQueries,
              queries: expandedQueries,
              location: d.location ?? null,
              hoursOld: d.hoursOld ?? null,
              resultsWanted: null,
              smartExpand: d.smartExpand,
              includeFromQueries: d.includeFromQueries,
              titleMatch: d.titleMatch,
              applyExcludes: d.applyExcludes,
              excludeTitleTerms,
              excludeDescriptionRules,
              sources: sourceSelection.sources,
              sourceSelection: sourceSelection.selection,
            }),
            location: d.location ?? null,
            hoursOld: d.hoursOld ?? null,
            resultsWanted: null,
            includeFromQueries: d.includeFromQueries,
            filterDescription: d.applyExcludes,
          },
          select: { id: true },
        });
        return { kind: "created" as const, id: run.id };
      });

      if (txResult.kind === "quota") {
        return fetchRunQuotaExceededResponse(txResult.quotaViolation);
      }
      return NextResponse.json({ id: txResult.id }, { status: 201 });
    }

    const parsed = parseJsonValue(json, AUSchema, requestId);
    if (!parsed.ok) return parsed.response;
    const data = parsed.data;

    const fallbackTitle = data.title ?? data.queries?.[0] ?? "";
    const baseQueries = data.queries?.length
      ? data.queries
      : fallbackTitle
        ? [fallbackTitle]
        : [];
    const expandedQueries = data.smartExpand
      ? expandRoleQueries(baseQueries)
      : baseQueries;
    const baseKeys = new Set(
      baseQueries.map((query) => query.toLocaleLowerCase()),
    );
    const relatedQueries = expandedQueries.filter(
      (query) => !baseKeys.has(query.toLocaleLowerCase()),
    );
    const queries = uniqueStrings([...baseQueries, ...relatedQueries]).slice(
      0,
      MAX_EXPANDED_AU_QUERIES,
    );
    const title = fallbackTitle || queries[0] || "";

    const createData = {
      userId,
      status: "QUEUED" as const,
      importedCount: 0,
      queries: buildAuFetchRunConfigV1({
        title,
        baseQueries,
        queries,
        location: data.location ?? null,
        hoursOld: data.hoursOld ?? null,
        resultsWanted: null,
        smartExpand: data.smartExpand,
        includeFromQueries: data.includeFromQueries,
        titleMatch: data.titleMatch,
        applyExcludes: data.applyExcludes,
        excludeTitleTerms: data.excludeTitleTerms,
        excludeDescriptionRules: data.excludeDescriptionRules,
        source: data.source,
      }),
      location: data.location ?? null,
      hoursOld: data.hoursOld ?? null,
      resultsWanted: null,
      includeFromQueries: data.includeFromQueries,
      filterDescription: data.applyExcludes,
    };

    const txResult = await prisma.$transaction(async (tx) => {
      const quotaViolation = await checkFetchRunQuota(tx, userId, "create");
      if (quotaViolation) return { kind: "quota" as const, quotaViolation };

      const run = await tx.fetchRun.create({ data: createData, select: { id: true } });
      return { kind: "created" as const, id: run.id };
    });

    if (txResult.kind === "quota") {
      return fetchRunQuotaExceededResponse(txResult.quotaViolation);
    }
    return NextResponse.json({ id: txResult.id }, { status: 201 });
  });
}
