import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import {
  ATS_BOARD_CONFIGS,
  ATS_BOARD_REGISTRY_ISSUES,
} from "./registry";
import { parseAtsBoardRegistry } from "./atsBoards";

const CORE_SOURCES = [
  { sourceId: "remoteok", label: "Remote OK", provider: "remoteok" },
  { sourceId: "remotive", label: "Remotive", provider: "remotive" },
  { sourceId: "jobicy", label: "Jobicy", provider: "jobicy" },
] as const;

const SourceItemSchema = z
  .object({
    sourceId: z.string().min(1).max(60),
    kind: z.enum(["core", "ats"]),
    label: z.string().min(1).max(200),
    provider: z.string().min(1).max(32),
    region: z.string().max(20).nullable(),
    status: z.enum(["HEALTHY", "DEGRADED", "DOWN", "UNKNOWN"]),
    consecutiveFailures: z.number().int().nonnegative(),
    lastCheckedAt: z.string().datetime({ offset: true }).nullable(),
    lastReachableAt: z.string().datetime({ offset: true }).nullable(),
    lastFailureAt: z.string().datetime({ offset: true }).nullable(),
    reason: z.string().max(500).nullable(),
  })
  .strict();

export const SourceHealthReadModelSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    // Up to 250 environment boards + 250 DB boards + three core sources.
    sources: z.array(SourceItemSchema).max(503),
    summary: z
      .object({
        healthy: z.number().int().nonnegative(),
        degraded: z.number().int().nonnegative(),
        down: z.number().int().nonnegative(),
        unknown: z.number().int().nonnegative(),
      })
      .strict(),
    configurationIssueCount: z.number().int().nonnegative(),
  })
  .strict();

export type SourceHealthReadModel = z.infer<
  typeof SourceHealthReadModelSchema
>;

function dateValue(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

/** Authenticated read model for Fetch UI. No board tokens or careers URLs. */
export async function readSourceHealth(
  generatedAt: Date = new Date(),
): Promise<SourceHealthReadModel> {
  const boardRows = await prisma.atsBoardSource.findMany({
    where: { enabled: true },
    orderBy: [{ company: "asc" }, { provider: "asc" }],
    select: {
      sourceId: true,
      provider: true,
      boardToken: true,
      company: true,
      region: true,
      careersUrl: true,
      enabled: true,
    },
  });
  const parsedBoards = parseAtsBoardRegistry(boardRows);
  const boardsBySource = new Map(
    ATS_BOARD_CONFIGS.map((board) => [board.id, board]),
  );
  for (const board of parsedBoards.boards) {
    // DB-backed configuration is runtime-authoritative for a colliding ATS id.
    boardsBySource.set(board.id, board);
  }

  const definitions = [
    ...CORE_SOURCES.map((source) => ({
      ...source,
      kind: "core" as const,
      region: null,
    })),
    ...[...boardsBySource.values()]
      .sort(
        (left, right) =>
          left.company.localeCompare(right.company) ||
          left.id.localeCompare(right.id),
      )
      .map((board) => ({
        sourceId: board.id,
        kind: "ats" as const,
        label: board.company,
        provider: board.provider,
        region: board.region ?? null,
      })),
  ];
  const healthRows = await prisma.sourceHealth.findMany({
    where: {
      source: { in: definitions.map((source) => source.sourceId) },
    },
    select: {
      source: true,
      status: true,
      consecutiveFailures: true,
      lastCheckedAt: true,
      lastReachableAt: true,
      lastFailureAt: true,
      reason: true,
    },
  });
  const healthBySource = new Map(
    healthRows.map((health) => [health.source, health]),
  );

  const sources = definitions.map((definition) => {
    const health = healthBySource.get(definition.sourceId);
    return {
      ...definition,
      status: health?.status ?? ("UNKNOWN" as const),
      consecutiveFailures: Math.max(
        0,
        Math.trunc(health?.consecutiveFailures ?? 0),
      ),
      lastCheckedAt: dateValue(health?.lastCheckedAt ?? null),
      lastReachableAt: dateValue(health?.lastReachableAt ?? null),
      lastFailureAt: dateValue(health?.lastFailureAt ?? null),
      reason: health?.reason?.slice(0, 500) ?? null,
    };
  });
  const summary = {
    healthy: sources.filter((source) => source.status === "HEALTHY").length,
    degraded: sources.filter((source) => source.status === "DEGRADED").length,
    down: sources.filter((source) => source.status === "DOWN").length,
    unknown: sources.filter((source) => source.status === "UNKNOWN").length,
  };

  return SourceHealthReadModelSchema.parse({
    generatedAt: generatedAt.toISOString(),
    sources,
    summary,
    configurationIssueCount:
      ATS_BOARD_REGISTRY_ISSUES.length + parsedBoards.issues.length,
  });
}
