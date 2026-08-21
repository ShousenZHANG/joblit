import { z } from "zod";
import { TITLE_MATCH_MODES, resolveTitleMatchMode } from "@/lib/shared/jobRelevance";
import {
  AU_EXCLUDE_SENIOR_FETCH_POLICY,
  AU_FETCH_POLICY,
  RegisteredAuFetchPolicySchema,
} from "@/lib/shared/fetchPolicy";

export const FETCH_RUN_CONFIG_SCHEMA_VERSION = 1 as const;
export const AU_FETCH_RUN_CONFIG_SCHEMA_VERSION = 2 as const;

const QuerySchema = z.string().trim().min(1).max(120);
const QueryListSchema = z.array(QuerySchema).min(1).max(100);
const OptionalLocationSchema = z.string().trim().min(1).max(160).nullable();
const OptionalHoursOldSchema = z.number().int().min(1).max(24 * 30).nullable();
const OptionalResultsWantedSchema = z.number().int().positive().nullable();

export const FetchRunDispatchMetaSchema = z
  .object({
    inFlightAt: z.string().datetime().optional(),
    dispatchedAt: z.string().datetime().optional(),
    idempotencyKey: z.string().trim().min(1).max(512).optional(),
    idempotencyAt: z.string().datetime().optional(),
  })
  .strict();

const DispatchMetaField = {
  dispatchMeta: FetchRunDispatchMetaSchema.optional(),
} as const;

/** Historical AU worker contract retained for already-created AU runs. */
export const AuFetchRunConfigV1Schema = z
  .object({
    schemaVersion: z.literal(FETCH_RUN_CONFIG_SCHEMA_VERSION),
    market: z.literal("AU"),
    title: z.string().trim().min(1).max(120),
    baseQueries: z.array(QuerySchema).min(1).max(12),
    queries: QueryListSchema.max(24),
    location: OptionalLocationSchema,
    hoursOld: OptionalHoursOldSchema,
    resultsWanted: OptionalResultsWantedSchema,
    smartExpand: z.boolean(),
    includeFromQueries: z.boolean(),
    titleMatch: z.enum(TITLE_MATCH_MODES).optional(),
    applyExcludes: z.boolean(),
    excludeTitleTerms: z.array(z.string().trim().min(1).max(40)).max(24),
    excludeDescriptionRules: z
      .array(z.string().trim().min(1).max(80))
      .max(24),
    source: z.literal("jobspy"),
    ...DispatchMetaField,
  })
  .strict();

/**
 * Recall-safe AU contract. Search and exclusion behaviour is server-owned;
 * the client can provide search intent but cannot weaken the stored policy.
 */
export const AuFetchRunConfigV2Schema = z
  .object({
    schemaVersion: z.literal(AU_FETCH_RUN_CONFIG_SCHEMA_VERSION),
    market: z.literal("AU"),
    title: z.string().trim().min(1).max(120),
    baseQueries: z.array(QuerySchema).min(1).max(12),
    queries: QueryListSchema.max(24),
    location: OptionalLocationSchema,
    hoursOld: OptionalHoursOldSchema,
    resultsWanted: OptionalResultsWantedSchema,
    smartExpand: z.literal(true),
    includeFromQueries: z.literal(true),
    titleMatch: z.literal("relaxed"),
    policy: RegisteredAuFetchPolicySchema,
    source: z.literal("jobspy"),
    ...DispatchMetaField,
  })
  .strict();

export const FetchRunConfigSchema = z.union([
  AuFetchRunConfigV2Schema,
  AuFetchRunConfigV1Schema,
]);

export type FetchRunDispatchMeta = z.infer<
  typeof FetchRunDispatchMetaSchema
>;
export type AuFetchRunConfigV1 = z.infer<typeof AuFetchRunConfigV1Schema>;
export type AuFetchRunConfigV2 = z.infer<typeof AuFetchRunConfigV2Schema>;
export type FetchRunConfig = z.infer<typeof FetchRunConfigSchema>;

type AuFetchRunConfigV1Input = Omit<
  AuFetchRunConfigV1,
  "schemaVersion" | "market"
>;

export function buildAuFetchRunConfigV1(
  input: AuFetchRunConfigV1Input,
): AuFetchRunConfigV1 {
  return AuFetchRunConfigV1Schema.parse({
    schemaVersion: FETCH_RUN_CONFIG_SCHEMA_VERSION,
    market: "AU",
    ...input,
  });
}

type AuFetchRunConfigV2Input = Omit<
  AuFetchRunConfigV2,
  | "schemaVersion"
  | "market"
  | "smartExpand"
  | "includeFromQueries"
  | "titleMatch"
  | "policy"
  | "source"
>;

export interface AuFetchRunPolicyIntent {
  /**
   * Per-run opt-in to the stricter policy that also removes visible Senior
   * titles. Callers express intent only; they never choose a policy id, so a
   * request can tighten the stored policy but can never weaken it.
   */
  excludeSeniorTitles?: boolean;
}

export function buildAuFetchRunConfigV2(
  input: AuFetchRunConfigV2Input,
  intent: AuFetchRunPolicyIntent = {},
): AuFetchRunConfigV2 {
  return AuFetchRunConfigV2Schema.parse({
    ...input,
    schemaVersion: AU_FETCH_RUN_CONFIG_SCHEMA_VERSION,
    market: "AU",
    smartExpand: true,
    includeFromQueries: true,
    titleMatch: "relaxed",
    policy: intent.excludeSeniorTitles
      ? AU_EXCLUDE_SENIOR_FETCH_POLICY
      : AU_FETCH_POLICY,
    source: "jobspy",
  });
}

export function readFetchRunDispatchMeta(raw: unknown): FetchRunDispatchMeta {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const meta = (raw as Record<string, unknown>).dispatchMeta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  const value = meta as Record<string, unknown>;
  const timestamp = (candidate: unknown) => {
    const parsed = z.string().datetime().safeParse(candidate);
    return parsed.success ? parsed.data : undefined;
  };
  const idempotencyKey = z
    .string()
    .trim()
    .min(1)
    .max(512)
    .safeParse(value.idempotencyKey);
  const inFlightAt = timestamp(value.inFlightAt);
  const dispatchedAt = timestamp(value.dispatchedAt);
  const idempotencyAt = timestamp(value.idempotencyAt);
  return {
    ...(inFlightAt ? { inFlightAt } : {}),
    ...(dispatchedAt ? { dispatchedAt } : {}),
    ...(idempotencyKey.success
      ? { idempotencyKey: idempotencyKey.data }
      : {}),
    ...(idempotencyAt ? { idempotencyAt } : {}),
  };
}

/** Patch dispatch bookkeeping without parsing the rest of the worker config. */
export function withFetchRunDispatchMeta(
  raw: unknown,
  patch: Partial<FetchRunDispatchMeta>,
): Record<string, unknown> {
  // Historical AU rows sometimes stored the query list as the JSON root.
  const base = Array.isArray(raw)
    ? { queries: raw }
    : raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};
  const next: FetchRunDispatchMeta = {
    ...readFetchRunDispatchMeta(base),
    ...patch,
  };

  for (const key of [
    "inFlightAt",
    "dispatchedAt",
    "idempotencyKey",
    "idempotencyAt",
  ] as const) {
    if (!next[key]) delete next[key];
  }

  return {
    ...base,
    dispatchMeta: FetchRunDispatchMetaSchema.parse(next),
  };
}

export interface StoredFetchRunConfigInput {
  market?: unknown;
  queries?: unknown;
  location?: unknown;
  hoursOld?: unknown;
  resultsWanted?: unknown;
  includeFromQueries?: unknown;
  filterDescription?: unknown;
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const values: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const cleaned = candidate.trim();
    const key = cleaned.toLocaleLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    values.push(cleaned);
  }
  return values;
}

function optionalString(...values: unknown[]): string | null {
  for (const value of values) {
    if (value === null) return null;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function optionalPositiveInteger(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null) return null;
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      return value;
    }
  }
  return null;
}

function booleanOr(defaultValue: boolean, ...values: unknown[]): boolean {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return defaultValue;
}

function assertAuMarket(input: StoredFetchRunConfigInput): void {
  const rowMarket = input.market;
  const configMarket = recordOf(input.queries).market;
  if (
    (typeof rowMarket === "string" && rowMarket !== "AU") ||
    (typeof configMarket === "string" && configMarket !== "AU")
  ) {
    throw new Error("FetchRun market is retired; only AU is executable");
  }
}

function dispatchMetaField(
  raw: Record<string, unknown>,
): Pick<AuFetchRunConfigV1, "dispatchMeta"> {
  const dispatchMeta = readFetchRunDispatchMeta(raw);
  return Object.keys(dispatchMeta).length > 0 ? { dispatchMeta } : {};
}

/**
 * Read historical unversioned AU rows into the v1 worker contract.
 * Non-AU rows fail closed and must be removed by the retirement cleanup.
 */
export function normalizeFetchRunConfigV1(
  input: StoredFetchRunConfigInput,
): AuFetchRunConfigV1 {
  assertAuMarket(input);
  const raw = input.queries;
  const rawRecord = recordOf(raw);
  if ("schemaVersion" in rawRecord) {
    return AuFetchRunConfigV1Schema.parse(rawRecord);
  }

  const rawQueries = Array.isArray(raw)
    ? uniqueStrings(raw)
    : uniqueStrings(rawRecord.queries);
  const rawTitle = optionalString(rawRecord.title);
  const smartExpand = booleanOr(true, rawRecord.smartExpand);
  const queries =
    rawQueries.length > 0 ? rawQueries : rawTitle ? [rawTitle] : [];
  const explicitBaseQueries = uniqueStrings(rawRecord.baseQueries);
  const baseQueries =
    explicitBaseQueries.length > 0
      ? explicitBaseQueries
      : !smartExpand
        ? queries
        : rawTitle
          ? [rawTitle]
          : queries;
  const includeFromQueries = booleanOr(
    true,
    rawRecord.includeFromQueries,
    input.includeFromQueries,
  );
  const applyExcludes = booleanOr(
    true,
    rawRecord.applyExcludes,
    input.filterDescription,
  );

  return buildAuFetchRunConfigV1({
    title: rawTitle ?? baseQueries[0] ?? queries[0] ?? "",
    baseQueries,
    queries,
    smartExpand,
    location: optionalString(rawRecord.location, input.location),
    hoursOld: optionalPositiveInteger(rawRecord.hoursOld, input.hoursOld),
    resultsWanted: optionalPositiveInteger(
      rawRecord.resultsWanted,
      input.resultsWanted,
    ),
    includeFromQueries,
    titleMatch: resolveTitleMatchMode({
      titleMatch: rawRecord.titleMatch,
      includeFromQueries,
    }),
    applyExcludes,
    excludeTitleTerms: applyExcludes
      ? uniqueStrings(rawRecord.excludeTitleTerms)
      : [],
    excludeDescriptionRules: applyExcludes
      ? uniqueStrings(rawRecord.excludeDescriptionRules)
      : [],
    source: "jobspy",
    ...dispatchMetaField(rawRecord),
  });
}

/** Read the strict AU v1/v2 contracts with legacy AU row compatibility. */
export function normalizeFetchRunConfig(
  input: StoredFetchRunConfigInput,
): FetchRunConfig {
  assertAuMarket(input);
  const rawRecord = recordOf(input.queries);
  if (!("schemaVersion" in rawRecord)) {
    return normalizeFetchRunConfigV1(input);
  }
  return FetchRunConfigSchema.parse(rawRecord);
}

export interface LegacyFetchRunConfigFields {
  queries: FetchRunConfig;
  location: string | null;
  hoursOld: number | null;
  resultsWanted: number | null;
  includeFromQueries: boolean;
  filterDescription: boolean;
}

/** Compatibility projection consumed by the current Python AU worker. */
export function toLegacyFetchRunConfigFields(
  config: FetchRunConfig,
): LegacyFetchRunConfigFields {
  return {
    queries: config,
    location: config.location,
    hoursOld: config.hoursOld,
    resultsWanted: config.resultsWanted,
    includeFromQueries: config.includeFromQueries,
    filterDescription:
      config.schemaVersion === AU_FETCH_RUN_CONFIG_SCHEMA_VERSION
        ? true
        : config.applyExcludes,
  };
}
