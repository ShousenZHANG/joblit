import { describe, expect, it } from "vitest";
import {
  AU_EXCLUDE_SENIOR_FETCH_POLICY,
  AU_FETCH_POLICY,
} from "@/lib/shared/fetchPolicy";
import {
  AU_FETCH_RUN_CONFIG_SCHEMA_VERSION,
  FETCH_RUN_CONFIG_SCHEMA_VERSION,
  AuFetchRunConfigV2Schema,
  AuFetchRunConfigV1Schema,
  buildAuFetchRunConfigV1,
  buildAuFetchRunConfigV2,
  normalizeFetchRunConfig,
  normalizeFetchRunConfigV1,
  readFetchRunDispatchMeta,
  toLegacyFetchRunConfigFields,
  withFetchRunDispatchMeta,
} from "./fetchRunConfig";

function auV1Config() {
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

describe("AU FetchRunConfig senior-exclusion intent", () => {
  it("stamps the active policy when the caller expresses no intent", () => {
    expect(auV2Config().policy).toEqual(AU_FETCH_POLICY);
    expect(
      buildAuFetchRunConfigV2(
        {
          title: "Software Engineer",
          baseQueries: ["Software Engineer"],
          queries: ["Software Engineer"],
          location: null,
          hoursOld: null,
          resultsWanted: null,
        },
        { excludeSeniorTitles: false },
      ).policy,
    ).toEqual(AU_FETCH_POLICY);
  });

  it("stamps the stricter policy when the caller opts in", () => {
    const config = buildAuFetchRunConfigV2(
      {
        title: "Software Engineer",
        baseQueries: ["Software Engineer"],
        queries: ["Software Engineer"],
        location: null,
        hoursOld: null,
        resultsWanted: null,
      },
      { excludeSeniorTitles: true },
    );

    expect(config.policy).toEqual(AU_EXCLUDE_SENIOR_FETCH_POLICY);
    expect(config.policy.seniorityCeiling).toBe("mid");
    // The run still parses as the current worker contract, so opting in never
    // forks the schema version.
    expect(AuFetchRunConfigV2Schema.parse(config)).toEqual(config);
  });

  it("keeps the opt-in strictly stronger than the default", () => {
    expect(AU_FETCH_POLICY.seniorityCeiling).toBe("senior");
    expect(AU_EXCLUDE_SENIOR_FETCH_POLICY.seniorityCeiling).toBe("mid");
  });
});

describe("AU FetchRunConfig", () => {
  it("keeps the closed v1 worker contract for historical AU runs", () => {
    const config = auV1Config();
    expect(config.schemaVersion).toBe(FETCH_RUN_CONFIG_SCHEMA_VERSION);
    expect(AuFetchRunConfigV1Schema.parse(config)).toEqual(config);
    expect(() =>
      AuFetchRunConfigV1Schema.parse({ ...config, unknown: true }),
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
    expect(config.baseQueries).toEqual(["Software Engineer"]);
    expect(config.dispatchMeta).toEqual({
      dispatchedAt: "2026-07-24T01:02:03.000Z",
      idempotencyKey: "request-1",
    });
  });

  it.each(["CN", "GLOBAL"])("fails closed for retired %s rows", (market) => {
    expect(() =>
      normalizeFetchRunConfig({ market, queries: { market } }),
    ).toThrow(/retired/);
  });

  it("patches dispatch metadata without discarding the AU payload", () => {
    const withClaim = withFetchRunDispatchMeta(auV1Config(), {
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
    expect(AuFetchRunConfigV1Schema.parse(dispatched).market).toBe("AU");
  });

  it("preserves a legacy root query array while adding dispatch metadata", () => {
    const dispatched = withFetchRunDispatchMeta(
      ["Software Engineer", "Backend Engineer"],
      { dispatchedAt: "2026-07-24T01:02:04.000Z" },
    );
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
      queries: ["Software Engineer", "Backend Engineer"],
      dispatchMeta: { dispatchedAt: "2026-07-24T01:02:04.000Z" },
    });
  });

  it("builds the server-owned v2 recall-safe policy", () => {
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
    expect(AuFetchRunConfigV2Schema.parse(config)).toEqual(config);
  });

  it("recognizes v2 while keeping the v1-only normalizer strict", () => {
    expect(normalizeFetchRunConfig({ market: "AU", queries: auV2Config() })).toEqual(
      auV2Config(),
    );
    expect(() =>
      normalizeFetchRunConfigV1({ market: "AU", queries: auV2Config() }),
    ).toThrow();
  });

  it("projects AU v1 and v2 into the Python worker shape", () => {
    for (const config of [auV1Config(), auV2Config()]) {
      expect(toLegacyFetchRunConfigFields(config)).toEqual({
        queries: config,
        location: "Sydney",
        hoursOld: 48,
        resultsWanted: null,
        includeFromQueries: true,
        filterDescription: true,
      });
    }
  });
});
