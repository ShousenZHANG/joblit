import { describe, expect, it } from "vitest";
import { AU_FETCH_POLICY } from "@/lib/shared/fetchPolicy";
import {
  AU_FETCH_RUN_CONFIG_SCHEMA_VERSION,
  FETCH_RUN_CONFIG_SCHEMA_VERSION,
  AuFetchRunConfigV2Schema,
  FetchRunConfigV1Schema,
  buildAuFetchRunConfigV1,
  buildAuFetchRunConfigV2,
  buildCnFetchRunConfigV1,
  buildGlobalFetchRunConfigV1,
  normalizeFetchRunConfig,
  normalizeFetchRunConfigV1,
  readFetchRunDispatchMeta,
  toLegacyFetchRunConfigFields,
  withFetchRunDispatchMeta,
} from "./fetchRunConfig";

function auConfig() {
  return buildAuFetchRunConfigV1({
    title: "Software Engineer",
    baseQueries: ["Software Engineer"],
    queries: ["Software Engineer", "Backend Engineer"],
    location: "Sydney",
    hoursOld: 48,
    resultsWanted: null,
    smartExpand: true,
    includeFromQueries: true,
    applyExcludes: true,
    excludeTitleTerms: ["intern"],
    excludeDescriptionRules: ["identity_requirement"],
    source: "jobspy",
  });
}

describe("FetchRunConfig v1", () => {
  it("builds a closed discriminated contract for every market", () => {
    const configs = [
      auConfig(),
      buildCnFetchRunConfigV1({
        title: "后端工程师",
        queries: ["后端工程师"],
        sources: ["nowcoder"],
        excludeKeywords: ["实习"],
        locations: ["上海"],
      }),
      buildGlobalFetchRunConfigV1({
        title: "AI Engineer",
        baseQueries: ["AI Engineer"],
        queries: ["AI Engineer", "Machine Learning Engineer"],
        location: null,
        hoursOld: 24,
        resultsWanted: null,
        smartExpand: true,
        includeFromQueries: true,
        applyExcludes: false,
        excludeTitleTerms: [],
        excludeDescriptionRules: [],
        sources: ["remoteok"],
        sourceSelection: "explicit",
      }),
    ];

    expect(configs.map((config) => config.market)).toEqual([
      "AU",
      "CN",
      "GLOBAL",
    ]);
    for (const config of configs) {
      expect(config.schemaVersion).toBe(FETCH_RUN_CONFIG_SCHEMA_VERSION);
      expect(FetchRunConfigV1Schema.parse(config)).toEqual(config);
    }
    expect(() =>
      FetchRunConfigV1Schema.parse({ ...configs[0], unknown: true }),
    ).toThrow();
  });

  it("normalizes a legacy AU list with scalar-column compatibility", () => {
    expect(
      normalizeFetchRunConfigV1({
        market: "AU",
        queries: [" Software Engineer ", "software engineer", "Data Engineer"],
        location: "Sydney",
        hoursOld: 72,
        resultsWanted: null,
        includeFromQueries: false,
        filterDescription: false,
      }),
    ).toMatchObject({
      schemaVersion: 1,
      market: "AU",
      title: "Software Engineer",
      baseQueries: ["Software Engineer", "Data Engineer"],
      queries: ["Software Engineer", "Data Engineer"],
      location: "Sydney",
      hoursOld: 72,
      includeFromQueries: false,
      applyExcludes: false,
      source: "jobspy",
    });
  });

  it("preserves legacy base-query and dispatch intent", () => {
    const config = normalizeFetchRunConfigV1({
      market: "AU",
      queries: {
        title: "Software Engineer",
        baseQueries: ["Software Engineer"],
        queries: ["Software Engineer", "Full Stack Engineer"],
        smartExpand: true,
        dispatchMeta: {
          dispatchedAt: "2026-07-24T01:02:03.000Z",
          idempotencyKey: "request-1",
        },
      },
    });

    expect(config.market).toBe("AU");
    if (config.market !== "AU") throw new Error("expected AU config");
    expect(config.baseQueries).toEqual(["Software Engineer"]);
    expect(config.dispatchMeta).toEqual({
      dispatchedAt: "2026-07-24T01:02:03.000Z",
      idempotencyKey: "request-1",
    });
  });

  it("normalizes legacy CN and GLOBAL rows through the same seam", () => {
    const cn = normalizeFetchRunConfigV1({
      market: "CN",
      queries: {
        queries: ["后端工程师"],
        excludeKeywords: ["实习"],
        locations: ["上海"],
      },
    });
    const global = normalizeFetchRunConfigV1({
      market: "GLOBAL",
      queries: {
        title: "Platform Engineer",
        queries: ["Platform Engineer"],
      },
      hoursOld: 24,
    });

    expect(cn).toMatchObject({
      market: "CN",
      title: "后端工程师",
      sources: ["nowcoder"],
    });
    expect(global).toMatchObject({
      market: "GLOBAL",
      sourceSelection: "all",
      sources: [],
      hoursOld: 24,
    });
  });

  it("fails closed for invalid or market-mismatched versioned rows", () => {
    const config = auConfig();
    expect(() =>
      normalizeFetchRunConfigV1({
        market: "AU",
        queries: { ...config, schemaVersion: 2 },
      }),
    ).toThrow();
    expect(() =>
      normalizeFetchRunConfigV1({
        market: "GLOBAL",
        queries: config,
      }),
    ).toThrow(/market mismatch/);
  });

  it("patches dispatch metadata without discarding the market payload", () => {
    const config = auConfig();
    const withClaim = withFetchRunDispatchMeta(config, {
      inFlightAt: "2026-07-24T01:02:03.000Z",
      idempotencyKey: "request-1",
    });
    const dispatched = withFetchRunDispatchMeta(withClaim, {
      inFlightAt: undefined,
      dispatchedAt: "2026-07-24T01:02:04.000Z",
    });

    expect(dispatched.title).toBe("Software Engineer");
    expect(readFetchRunDispatchMeta(dispatched)).toEqual({
      dispatchedAt: "2026-07-24T01:02:04.000Z",
      idempotencyKey: "request-1",
    });
    expect(
      readFetchRunDispatchMeta({
        dispatchMeta: {
          dispatchedAt: "2026-07-24T01:02:04.000Z",
          idempotencyAt: "not-a-timestamp",
          futureField: true,
        },
      }),
    ).toEqual({ dispatchedAt: "2026-07-24T01:02:04.000Z" });
    expect(FetchRunConfigV1Schema.parse(dispatched).market).toBe("AU");
  });

  it("preserves a legacy root query array while adding dispatch metadata", () => {
    const dispatched = withFetchRunDispatchMeta(
      ["Software Engineer", "Backend Engineer"],
      { dispatchedAt: "2026-07-24T01:02:04.000Z" },
    );

    expect(dispatched.queries).toEqual([
      "Software Engineer",
      "Backend Engineer",
    ]);
    expect(
      normalizeFetchRunConfigV1({
        market: "AU",
        queries: dispatched,
        location: "Sydney",
        hoursOld: 48,
        includeFromQueries: true,
        filterDescription: true,
      }),
    ).toMatchObject({
      schemaVersion: 1,
      market: "AU",
      title: "Software Engineer",
      queries: ["Software Engineer", "Backend Engineer"],
      dispatchMeta: {
        dispatchedAt: "2026-07-24T01:02:04.000Z",
      },
    });
  });

  it("normalizes a historical GLOBAL source-only row without inventing a query", () => {
    expect(
      normalizeFetchRunConfigV1({
        market: "GLOBAL",
        queries: { sources: ["remoteok"] },
      }),
    ).toMatchObject({
      schemaVersion: 1,
      market: "GLOBAL",
      queryMode: "source-only",
      title: "",
      baseQueries: [],
      queries: [],
      sources: ["remoteok"],
      sourceSelection: "explicit",
    });
  });

  it("projects canonical AU config into the current worker shape", () => {
    const config = auConfig();
    expect(toLegacyFetchRunConfigFields(config)).toEqual({
      queries: config,
      location: "Sydney",
      hoursOld: 48,
      resultsWanted: null,
      includeFromQueries: true,
      filterDescription: true,
    });
  });

  it("requires a source for an explicit GLOBAL selection", () => {
    expect(() =>
      buildGlobalFetchRunConfigV1({
        title: "AI Engineer",
        baseQueries: ["AI Engineer"],
        queries: ["AI Engineer"],
        location: null,
        hoursOld: null,
        resultsWanted: null,
        smartExpand: false,
        includeFromQueries: true,
        applyExcludes: false,
        excludeTitleTerms: [],
        excludeDescriptionRules: [],
        sources: [],
        sourceSelection: "explicit",
      }),
    ).toThrow();
  });
});

describe("AU FetchRunConfig v2", () => {
  function auV2Config() {
    return buildAuFetchRunConfigV2({
      title: "Software Engineer",
      baseQueries: ["Software Engineer"],
      queries: ["Software Engineer", "Backend Engineer"],
      location: "Sydney",
      hoursOld: 48,
      resultsWanted: null,
    });
  }

  it("builds the server-owned recall-safe policy without free-form exclusions", () => {
    const config = auV2Config();

    expect(config).toMatchObject({
      schemaVersion: AU_FETCH_RUN_CONFIG_SCHEMA_VERSION,
      market: "AU",
      smartExpand: true,
      includeFromQueries: true,
      titleMatch: "relaxed",
      policy: AU_FETCH_POLICY,
      source: "jobspy",
    });
    expect(config).not.toHaveProperty("applyExcludes");
    expect(config).not.toHaveProperty("excludeTitleTerms");
    expect(config).not.toHaveProperty("excludeDescriptionRules");
    expect(AuFetchRunConfigV2Schema.parse(config)).toEqual(config);
    expect(() =>
      AuFetchRunConfigV2Schema.parse({
        ...config,
        excludeTitleTerms: ["intern"],
      }),
    ).toThrow();
    expect(() =>
      AuFetchRunConfigV2Schema.parse({
        ...config,
        policy: { ...config.policy, experienceYears: "exclude-4-plus" },
      }),
    ).toThrow();
  });

  it("recognizes v2 while keeping the v1-only normalizer strict", () => {
    const config = auV2Config();
    const versionedV1 = auConfig();

    expect(
      normalizeFetchRunConfig({ market: "AU", queries: config }),
    ).toEqual(config);
    expect(
      normalizeFetchRunConfig({ market: "AU", queries: versionedV1 }),
    ).toEqual(versionedV1);
    expect(() =>
      normalizeFetchRunConfigV1({ market: "AU", queries: config }),
    ).toThrow();
    expect(
      normalizeFetchRunConfig({
        market: "AU",
        queries: ["Software Engineer"],
      }),
    ).toMatchObject({
      schemaVersion: FETCH_RUN_CONFIG_SCHEMA_VERSION,
      market: "AU",
    });
    expect(() =>
      normalizeFetchRunConfig({
        market: "AU",
        queries: { ...config, schemaVersion: 3 },
      }),
    ).toThrow();
  });

  it("preserves policy and schema identity when dispatch metadata is patched", () => {
    const config = auV2Config();
    const dispatched = withFetchRunDispatchMeta(config, {
      dispatchedAt: "2026-08-02T01:02:03.000Z",
      idempotencyKey: "request-v2",
    });

    expect(AuFetchRunConfigV2Schema.parse(dispatched)).toMatchObject({
      schemaVersion: AU_FETCH_RUN_CONFIG_SCHEMA_VERSION,
      policy: AU_FETCH_POLICY,
      dispatchMeta: {
        dispatchedAt: "2026-08-02T01:02:03.000Z",
        idempotencyKey: "request-v2",
      },
    });
    expect(dispatched.policy).toEqual(config.policy);
  });

  it("projects v2 into the legacy worker columns without restoring old knobs", () => {
    const config = auV2Config();

    expect(toLegacyFetchRunConfigFields(config)).toEqual({
      queries: config,
      location: "Sydney",
      hoursOld: 48,
      resultsWanted: null,
      includeFromQueries: true,
      filterDescription: true,
    });
  });
});
