import { z } from "zod";

export const FETCH_RUN_CONFIG_SCHEMA_VERSION = 1 as const;

const ConfigStringSchema = z.string().trim().min(1).max(160);
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

/**
 * The persisted execution contract for the remote AU JobSpy adapter.
 *
 * Every effective fetch knob lives in this value even while the matching
 * scalar FetchRun columns remain available as legacy read projections.
 */
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
    applyExcludes: z.boolean(),
    excludeTitleTerms: z.array(z.string().trim().min(1).max(40)).max(24),
    excludeDescriptionRules: z
      .array(z.string().trim().min(1).max(80))
      .max(24),
    source: z.literal("jobspy"),
    ...DispatchMetaField,
  })
  .strict();

/** The persisted execution contract for the in-process CN adapter. */
export const CnFetchRunConfigV1Schema = z
  .object({
    schemaVersion: z.literal(FETCH_RUN_CONFIG_SCHEMA_VERSION),
    market: z.literal("CN"),
    title: z.string().trim().min(1).max(120),
    queries: z.array(QuerySchema).min(1).max(12),
    sources: z.array(z.literal("nowcoder")).min(1).max(1),
    excludeKeywords: z.array(z.string().trim().min(1).max(40)).max(24),
    locations: z.array(z.string().trim().min(1).max(80)).max(12),
    ...DispatchMetaField,
  })
  .strict();

/**
 * The persisted execution contract for public feeds and configured ATS
 * boards. An empty `sources` list is accepted only to represent the intent of
 * a pre-v1 legacy "all sources" row; v1 builders always persist resolved IDs.
 */
export const GlobalFetchRunConfigV1Schema = z
  .object({
    schemaVersion: z.literal(FETCH_RUN_CONFIG_SCHEMA_VERSION),
    market: z.literal("GLOBAL"),
    title: z.string().trim().max(120),
    baseQueries: z.array(QuerySchema).max(12),
    queries: z.array(QuerySchema).max(100),
    queryMode: z.enum(["query", "source-only"]).optional(),
    location: OptionalLocationSchema,
    hoursOld: OptionalHoursOldSchema,
    resultsWanted: OptionalResultsWantedSchema,
    smartExpand: z.boolean(),
    includeFromQueries: z.boolean(),
    applyExcludes: z.boolean(),
    excludeTitleTerms: z.array(z.string().trim().min(1).max(40)).max(24),
    excludeDescriptionRules: z
      .array(z.string().trim().min(1).max(80))
      .max(24),
    sources: z.array(ConfigStringSchema).max(24),
    sourceSelection: z.enum(["all", "explicit"]),
    ...DispatchMetaField,
  })
  .strict()
  .superRefine((config, context) => {
    if (config.queryMode === "source-only") {
      if (
        config.title ||
        config.baseQueries.length > 0 ||
        config.queries.length > 0 ||
        config.sources.length === 0 ||
        config.sourceSelection !== "explicit"
      ) {
        context.addIssue({
          code: "custom",
          message:
            "source-only config requires explicit sources and no synthetic query fields",
          path: ["queryMode"],
        });
      }
      return;
    }
    if (
      !config.title ||
      config.baseQueries.length === 0 ||
      config.queries.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "query config requires title, baseQueries, and queries",
        path: ["queries"],
      });
    }
    if (config.sourceSelection === "explicit" && config.sources.length === 0) {
      context.addIssue({
        code: "custom",
        message: "explicit source selection requires at least one source",
        path: ["sources"],
      });
    }
  });

export const FetchRunConfigV1Schema = z.discriminatedUnion("market", [
  AuFetchRunConfigV1Schema,
  CnFetchRunConfigV1Schema,
  GlobalFetchRunConfigV1Schema,
]);

export type FetchRunDispatchMeta = z.infer<
  typeof FetchRunDispatchMetaSchema
>;
export type AuFetchRunConfigV1 = z.infer<typeof AuFetchRunConfigV1Schema>;
export type CnFetchRunConfigV1 = z.infer<typeof CnFetchRunConfigV1Schema>;
export type GlobalFetchRunConfigV1 = z.infer<
  typeof GlobalFetchRunConfigV1Schema
>;
export type FetchRunConfigV1 = z.infer<typeof FetchRunConfigV1Schema>;
export type FetchRunMarket = FetchRunConfigV1["market"];

type ConfigInput<T extends FetchRunConfigV1> = Omit<
  T,
  "schemaVersion" | "market"
>;

export function buildAuFetchRunConfigV1(
  input: ConfigInput<AuFetchRunConfigV1>,
): AuFetchRunConfigV1 {
  return AuFetchRunConfigV1Schema.parse({
    schemaVersion: FETCH_RUN_CONFIG_SCHEMA_VERSION,
    market: "AU",
    ...input,
  });
}

export function buildCnFetchRunConfigV1(
  input: ConfigInput<CnFetchRunConfigV1>,
): CnFetchRunConfigV1 {
  return CnFetchRunConfigV1Schema.parse({
    schemaVersion: FETCH_RUN_CONFIG_SCHEMA_VERSION,
    market: "CN",
    ...input,
  });
}

export function buildGlobalFetchRunConfigV1(
  input: ConfigInput<GlobalFetchRunConfigV1>,
): GlobalFetchRunConfigV1 {
  return GlobalFetchRunConfigV1Schema.parse({
    schemaVersion: FETCH_RUN_CONFIG_SCHEMA_VERSION,
    market: "GLOBAL",
    ...input,
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

/**
 * Patch dispatch metadata without needing to understand the market-specific
 * payload. This keeps trigger bookkeeping behind the same JSON seam for both
 * legacy and v1 rows.
 */
export function withFetchRunDispatchMeta(
  raw: unknown,
  patch: Partial<FetchRunDispatchMeta>,
): Record<string, unknown> {
  // Historical AU rows sometimes stored the query list as the JSON root.
  // Preserve that payload when adding dispatch bookkeeping so the legacy
  // normalizer can still reconstruct a canonical v1 config afterwards.
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

function marketOf(input: StoredFetchRunConfigInput): FetchRunMarket {
  if (
    input.market === "AU" ||
    input.market === "CN" ||
    input.market === "GLOBAL"
  ) {
    return input.market;
  }
  const rawMarket = recordOf(input.queries).market;
  return rawMarket === "CN" || rawMarket === "GLOBAL" ? rawMarket : "AU";
}

function dispatchMetaField(
  raw: Record<string, unknown>,
): Pick<FetchRunConfigV1, "dispatchMeta"> {
  const dispatchMeta = readFetchRunDispatchMeta(raw);
  return Object.keys(dispatchMeta).length > 0 ? { dispatchMeta } : {};
}

type LegacySearchConfigFields = Omit<
  ConfigInput<AuFetchRunConfigV1>,
  "source"
>;

interface LegacyQueryIdentity {
  title: string;
  baseQueries: string[];
  queries: string[];
  smartExpand: boolean;
}

function normalizeVersionedFetchRunConfig(
  input: StoredFetchRunConfigInput,
  raw: Record<string, unknown>,
): FetchRunConfigV1 {
  const parsed = FetchRunConfigV1Schema.parse(raw);
  const rowMarket = marketOf(input);
  if (parsed.market !== rowMarket) {
    throw new Error(
      `FetchRun market mismatch: row=${rowMarket}, config=${parsed.market}`,
    );
  }
  return parsed;
}

function legacyQueryIdentity(
  raw: Record<string, unknown>,
  rawQueries: string[],
  rawTitle: string | null,
): LegacyQueryIdentity {
  const smartExpand = booleanOr(true, raw.smartExpand);
  const queries =
    rawQueries.length > 0 ? rawQueries : rawTitle ? [rawTitle] : [];
  const explicitBaseQueries = uniqueStrings(raw.baseQueries);
  const baseQueries =
    explicitBaseQueries.length > 0
      ? explicitBaseQueries
      : !smartExpand
        ? queries
        : rawTitle
          ? [rawTitle]
          : queries;

  return {
    title: rawTitle ?? baseQueries[0] ?? queries[0] ?? "",
    baseQueries,
    queries,
    smartExpand,
  };
}

function legacySearchConfigFields(
  input: StoredFetchRunConfigInput,
  raw: Record<string, unknown>,
  rawQueries: string[],
  rawTitle: string | null,
): LegacySearchConfigFields {
  const identity = legacyQueryIdentity(raw, rawQueries, rawTitle);
  const includeFromQueries = booleanOr(
    true,
    raw.includeFromQueries,
    input.includeFromQueries,
  );
  const applyExcludes = booleanOr(
    true,
    raw.applyExcludes,
    input.filterDescription,
  );

  return {
    ...identity,
    location: optionalString(raw.location, input.location),
    hoursOld: optionalPositiveInteger(raw.hoursOld, input.hoursOld),
    resultsWanted: optionalPositiveInteger(
      raw.resultsWanted,
      input.resultsWanted,
    ),
    includeFromQueries,
    applyExcludes,
    excludeTitleTerms: applyExcludes ? uniqueStrings(raw.excludeTitleTerms) : [],
    excludeDescriptionRules: applyExcludes
      ? uniqueStrings(raw.excludeDescriptionRules)
      : [],
    ...dispatchMetaField(raw),
  };
}

function normalizeLegacyCnConfig(
  raw: Record<string, unknown>,
  rawQueries: string[],
  rawTitle: string | null,
): CnFetchRunConfigV1 {
  return buildCnFetchRunConfigV1({
    title: rawTitle ?? rawQueries[0] ?? "",
    queries: rawQueries,
    // Nowcoder is the sole supported CN source. Legacy rows either omitted
    // the field or carried retired scraper IDs, so both normalize here.
    sources: ["nowcoder"],
    excludeKeywords: uniqueStrings(raw.excludeKeywords),
    locations: uniqueStrings(raw.locations),
    ...dispatchMetaField(raw),
  });
}

function normalizeLegacyGlobalConfig(
  fields: LegacySearchConfigFields,
  raw: Record<string, unknown>,
): GlobalFetchRunConfigV1 {
  const sources = uniqueStrings(raw.sources);
  const isSourceOnly =
    !fields.title &&
    fields.baseQueries.length === 0 &&
    fields.queries.length === 0;
  const sourceSelection =
    raw.sourceSelection === "explicit" || (isSourceOnly && sources.length > 0)
      ? "explicit"
      : "all";

  return buildGlobalFetchRunConfigV1({
    ...fields,
    ...(isSourceOnly ? { queryMode: "source-only" as const } : {}),
    sources,
    sourceSelection,
  });
}

function normalizeLegacyAuConfig(
  fields: LegacySearchConfigFields,
): AuFetchRunConfigV1 {
  return buildAuFetchRunConfigV1({
    ...fields,
    source: "jobspy",
  });
}

/**
 * Read either a v1 payload or one of the historical unversioned shapes.
 *
 * Versioned rows fail closed: an invalid v1 payload is never reinterpreted as
 * legacy data. This makes schema drift visible at the boundary.
 */
export function normalizeFetchRunConfigV1(
  input: StoredFetchRunConfigInput,
): FetchRunConfigV1 {
  const raw = input.queries;
  const rawRecord = recordOf(raw);

  if ("schemaVersion" in rawRecord) {
    return normalizeVersionedFetchRunConfig(input, rawRecord);
  }

  const market = marketOf(input);
  const rawQueries = Array.isArray(raw)
    ? uniqueStrings(raw)
    : uniqueStrings(rawRecord.queries);
  const rawTitle = optionalString(rawRecord.title);

  if (market === "CN") {
    return normalizeLegacyCnConfig(rawRecord, rawQueries, rawTitle);
  }

  const fields = legacySearchConfigFields(
    input,
    rawRecord,
    rawQueries,
    rawTitle,
  );
  return market === "GLOBAL"
    ? normalizeLegacyGlobalConfig(fields, rawRecord)
    : normalizeLegacyAuConfig(fields);
}

export interface LegacyFetchRunConfigFields {
  queries: FetchRunConfigV1;
  location: string | null;
  hoursOld: number | null;
  resultsWanted: number | null;
  includeFromQueries: boolean;
  filterDescription: boolean;
}

/**
 * Compatibility projection consumed by the current Python worker. New clients
 * should read `run.config`; this projection can be retired with that adapter.
 */
export function toLegacyFetchRunConfigFields(
  config: FetchRunConfigV1,
): LegacyFetchRunConfigFields {
  if (config.market === "CN") {
    return {
      queries: config,
      location: null,
      hoursOld: null,
      resultsWanted: null,
      includeFromQueries: false,
      filterDescription: false,
    };
  }
  return {
    queries: config,
    location: config.location,
    hoursOld: config.hoursOld,
    resultsWanted: config.resultsWanted,
    includeFromQueries: config.includeFromQueries,
    filterDescription: config.applyExcludes,
  };
}
