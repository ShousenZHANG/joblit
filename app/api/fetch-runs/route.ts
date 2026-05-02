import { NextResponse } from "next/server";
import { z } from "zod";
import { withEmailSessionRoute, parseJsonValue } from "@/lib/server/api/routeHandler";
import { prisma } from "@/lib/server/prisma";
import { expandRoleQueries } from "@/lib/shared/fetchRolePacks";
import {
  filterDescriptionExclusionRules,
  isTitleExclusionTerm,
} from "@/lib/shared/fetchExclusionCriteria";

export const runtime = "nodejs";

const TitleExcludeSchema = z.string().refine(isTitleExclusionTerm);

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
    excludeTitleTerms: z.array(TitleExcludeSchema).optional().default([]),
    excludeDescriptionRules: z
      .array(z.string())
      .optional()
      .default([])
      .transform(filterDescriptionExclusionRules),
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
    .array(z.enum(["v2ex", "github", "rsshub"]))
    .optional()
    .default(["v2ex", "github"]),
  excludeKeywords: z.array(z.string()).optional().default([]),
});

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

