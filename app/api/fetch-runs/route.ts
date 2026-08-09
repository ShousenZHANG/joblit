import { NextResponse } from "next/server";
import { z } from "zod";
import { withSessionRoute, parseJsonValue } from "@/lib/server/api/routeHandler";
import { errorJson } from "@/lib/server/api/errorResponse";
import { prisma } from "@/lib/server/prisma";
import { expandRoleQueries } from "@/lib/shared/fetchRolePacks";
import { buildAuFetchRunConfigV2 } from "@/lib/shared/schemas/fetchRunConfig";

export const runtime = "nodejs";

const MAX_AU_QUERIES = 12;
const MAX_AU_QUERY_LENGTH = 120;
const MAX_EXPANDED_AU_QUERIES = 24;

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
  .transform((value) => {
    if (!value) return [];
    if (typeof value === "string") {
      return value
        .split("|")
        .flatMap((chunk) => chunk.split(","))
        .map((query) => query.trim())
        .filter(Boolean);
    }
    return value.map((query) => query.trim()).filter(Boolean);
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
  })
  .refine((data) => (data.title ?? data.queries?.[0])?.trim(), {
    message: "title is required",
    path: ["title"],
  });

export async function POST(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const json = await req.json().catch(() => null);
    const market =
      json && typeof json === "object" && "market" in json
        ? (json as { market?: unknown }).market
        : "AU";
    if (market === "CN" || market === "GLOBAL") {
      return errorJson(
        "FETCH_MARKET_RETIRED",
        "This fetch market has been retired",
        410,
      );
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
    const expandedQueries = expandRoleQueries(baseQueries);
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

    const run = await prisma.$transaction((tx) =>
      tx.fetchRun.create({
        data: {
          userId,
          status: "QUEUED",
          market: "AU",
          importedCount: 0,
          queries: buildAuFetchRunConfigV2({
            title,
            baseQueries,
            queries,
            location: data.location ?? null,
            hoursOld: data.hoursOld ?? null,
            resultsWanted: null,
          }),
          location: data.location ?? null,
          hoursOld: data.hoursOld ?? null,
          resultsWanted: null,
          includeFromQueries: true,
          filterDescription: true,
        },
        select: { id: true },
      }),
    );

    return NextResponse.json({ id: run.id }, { status: 201 });
  });
}
