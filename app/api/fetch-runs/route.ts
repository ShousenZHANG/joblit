import { NextResponse } from "next/server";
import { requireSessionWithEmail, UnauthorizedError } from "@/lib/server/auth/requireSession";
import type { SessionContextWithEmail } from "@/lib/server/auth/requireSession";
import { unauthorizedError } from "@/lib/server/api/errorResponse";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { expandRoleQueries } from "@/lib/shared/fetchRolePacks";

export const runtime = "nodejs";

const TitleExcludeEnum = z.enum([
  "senior",
  "lead",
  "principal",
  "staff",
  "manager",
  "director",
  "head",
  "architect",
]);

const DESC_EXCLUDE_ALLOWED = new Set([
  "identity_requirement",
  "clearance_requirement",
  "sponsorship_unavailable",
]);

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
    excludeTitleTerms: z.array(TitleExcludeEnum).optional().default([]),
    excludeDescriptionRules: z
      .array(z.string())
      .optional()
      .default([])
      .transform((rules) => rules.filter((rule) => DESC_EXCLUDE_ALLOWED.has(rule))),
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
  let ctx: SessionContextWithEmail;
  try {
    ctx = await requireSessionWithEmail();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
  const { userId, userEmail } = ctx;

  const json = await req.json().catch(() => null);
  const marketHint =
    json && typeof json === "object" && "market" in json ? json.market : "AU";

  if (marketHint === "CN") {
    const parsed = CNSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_BODY", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
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

  const parsed = AUSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_BODY", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const fallbackTitle = parsed.data.title ?? parsed.data.queries?.[0] ?? "";
  const baseQueries = parsed.data.queries?.length
    ? parsed.data.queries
    : fallbackTitle
      ? [fallbackTitle]
      : [];
  const queries = parsed.data.smartExpand ? expandRoleQueries(baseQueries) : baseQueries;
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
        smartExpand: parsed.data.smartExpand,
        includeFromQueries: parsed.data.includeFromQueries,
        applyExcludes: parsed.data.applyExcludes,
        excludeTitleTerms: parsed.data.excludeTitleTerms,
        excludeDescriptionRules: parsed.data.excludeDescriptionRules,
      },
      location: parsed.data.location ?? null,
      hoursOld: parsed.data.hoursOld ?? null,
      resultsWanted: null,
      includeFromQueries: parsed.data.includeFromQueries,
      filterDescription: parsed.data.applyExcludes,
    },
    select: { id: true },
  });

  return NextResponse.json({ id: run.id }, { status: 201 });
}

