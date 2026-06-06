import { NextResponse } from "next/server";
import { z } from "zod";
import { withEmailSessionRoute, parseJsonValue } from "@/lib/server/api/routeHandler";
import { prisma } from "@/lib/server/prisma";
import { expandRoleQueries } from "@/lib/shared/fetchRolePacks";
import { filterDescriptionExclusionRules } from "@/lib/shared/fetchExclusionCriteria";

export const runtime = "nodejs";

// Product-level kill-switch for the Seek source — flip the env off to disable
// Seek instantly (no deploy) if its anti-bot blocks us at scale.
function isSeekEnabled(): boolean {
  const v = (process.env.SEEK_FETCH_ENABLED || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

// Title exclusions allow any user term (presets + custom). Lower-cased and
// length-bounded; the worker escapes each term before building its regex, so
// arbitrary input is injection-safe.
const TitleExcludeSchema = z.string().trim().toLowerCase().min(1).max(40);

const queriesField = z
  .union([z.array(z.string().min(1)), z.string().min(1)])
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
  });

const AUSchema = z
  .object({
    market: z.literal("AU").optional().default("AU"),
    title: z.string().trim().min(1).optional(),
    queries: queriesField,
    location: z.string().trim().min(1).optional(),
    hoursOld: z.coerce.number().int().min(1).max(24 * 30).optional(),
    smartExpand: z.coerce.boolean().optional().default(true),
    includeFromQueries: z.coerce.boolean().optional().default(false),
    applyExcludes: z.coerce.boolean().optional().default(true),
    excludeTitleTerms: z.array(TitleExcludeSchema).max(24).optional().default([]),
    excludeDescriptionRules: z
      .array(z.string())
      .optional()
      .default([])
      .transform(filterDescriptionExclusionRules),
    // Pipeline selector: "jobspy" (LinkedIn, default, unchanged) or "seek".
    source: z.enum(["jobspy", "seek"]).optional().default("jobspy"),
    classification: z.string().trim().max(40).optional(),
    daterange: z.coerce.number().int().min(1).max(31).optional(),
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
  queries: z.array(z.string().min(1)).min(1),
  sources: z
    .array(z.enum(["nowcoder"]))
    .optional()
    .default(["nowcoder"]),
  excludeKeywords: z.array(z.string()).optional().default([]),
  locations: z.array(z.string()).optional().default([]),
});

export async function GET() {
  return withEmailSessionRoute(async ({ userId }) => {
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
  return withEmailSessionRoute(async ({ userId, userEmail, requestId }) => {
    const json = await req.json().catch(() => null);
    const marketHint =
      json && typeof json === "object" && "market" in json ? json.market : "AU";

    if (marketHint === "CN") {
      const parsed = parseJsonValue(json, CNSchema, requestId);
      if (!parsed.ok) return parsed.response;
      const d = parsed.data;
      const title = d.queries[0] ?? "";
      const run = await prisma.fetchRun.create({
        data: {
          userId,
          userEmail: userEmail.toLowerCase(),
          status: "QUEUED",
          market: "CN",
          importedCount: 0,
          queries: {
            title,
            queries: d.queries,
            sources: d.sources,
            excludeKeywords: d.excludeKeywords,
            locations: d.locations,
          },
          location: null,
          hoursOld: null,
          resultsWanted: null,
          includeFromQueries: false,
          filterDescription: false,
        },
        select: { id: true },
      });
      return NextResponse.json({ id: run.id }, { status: 201 });
    }

    const parsed = parseJsonValue(json, AUSchema, requestId);
    if (!parsed.ok) return parsed.response;
    const data = parsed.data;

    if (data.source === "seek") {
      if (!isSeekEnabled()) {
        return NextResponse.json({ error: "SEEK_DISABLED" }, { status: 403 });
      }
      // Abuse guard: one in-flight Seek run per user. Seek shares a single
      // egress IP under Cloudflare, so unbounded concurrent runs would get the
      // whole product IP-blocked. Scoped to seek only — jobspy is unaffected.
      const activeSeek = await prisma.fetchRun.count({
        where: {
          userId,
          status: { in: ["QUEUED", "RUNNING"] },
          queries: { path: ["source"], equals: "seek" },
        },
      });
      if (activeSeek > 0) {
        return NextResponse.json({ error: "SEEK_RUN_IN_PROGRESS" }, { status: 429 });
      }
    }

    const fallbackTitle = data.title ?? data.queries?.[0] ?? "";
    const baseQueries = data.queries?.length
      ? data.queries
      : fallbackTitle
        ? [fallbackTitle]
        : [];
    const queries = data.smartExpand ? expandRoleQueries(baseQueries) : baseQueries;
    const title = fallbackTitle || queries[0] || "";

    const run = await prisma.fetchRun.create({
      data: {
        userId,
        userEmail: userEmail.toLowerCase(),
        status: "QUEUED",
        importedCount: 0,
        queries: {
          title,
          queries,
          smartExpand: data.smartExpand,
          includeFromQueries: data.includeFromQueries,
          applyExcludes: data.applyExcludes,
          excludeTitleTerms: data.excludeTitleTerms,
          excludeDescriptionRules: data.excludeDescriptionRules,
          source: data.source,
          ...(data.source === "seek"
            ? { classification: data.classification ?? "", daterange: data.daterange ?? 2 }
            : {}),
        },
        location: data.location ?? null,
        hoursOld: data.hoursOld ?? null,
        resultsWanted: null,
        includeFromQueries: data.includeFromQueries,
        filterDescription: data.applyExcludes,
      },
      select: { id: true },
    });

    return NextResponse.json({ id: run.id }, { status: 201 });
  });
}

