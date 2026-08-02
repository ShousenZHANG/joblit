import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  findUnique: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    fetchRun: {
      findUnique: harness.findUnique,
    },
  },
}));

vi.mock("@/lib/server/observability/errorReporter", () => ({
  reportError: harness.reportError,
}));

import { GET } from "@/app/api/fetch-runs/[id]/config/route";
import { AU_FETCH_POLICY } from "@/lib/shared/fetchPolicy";

const RUN_ID = "550e8400-e29b-41d4-a716-446655440000";

function getConfig(secret = "fetch-secret") {
  return GET(
    new Request(`http://localhost/api/fetch-runs/${RUN_ID}/config`, {
      headers: { "x-fetch-run-secret": secret },
    }),
    { params: Promise.resolve({ id: RUN_ID }) },
  );
}

describe("fetch run config api", () => {
  beforeEach(() => {
    process.env.FETCH_RUN_SECRET = "fetch-secret";
    harness.findUnique.mockReset();
    harness.reportError.mockReset();
  });

  it("returns canonical v1 config and the current worker projection", async () => {
    harness.findUnique.mockResolvedValue({
      id: RUN_ID,
      status: "QUEUED",
      market: "AU",
      error: null,
      importedCount: 0,
      queries: {
        title: "Software Engineer",
        baseQueries: ["Software Engineer"],
        queries: ["Software Engineer", "Backend Engineer"],
        smartExpand: true,
        includeFromQueries: true,
        applyExcludes: true,
        excludeTitleTerms: ["intern"],
        excludeDescriptionRules: ["identity_requirement"],
        source: "jobspy",
      },
      location: "Sydney",
      hoursOld: 48,
      resultsWanted: null,
      includeFromQueries: true,
      filterDescription: true,
    });

    const response = await getConfig();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.run.config).toMatchObject({
      schemaVersion: 1,
      market: "AU",
      title: "Software Engineer",
      location: "Sydney",
      hoursOld: 48,
    });
    expect(body.run.queries).toEqual(body.run.config);
    expect(body.run).not.toHaveProperty("userEmail");
    expect(body.run.includeFromQueries).toBe(true);
    expect(body.run.filterDescription).toBe(true);
  });

  it("returns a persisted AU config v2 with its historical v1 policy", async () => {
    harness.findUnique.mockResolvedValue({
      id: RUN_ID,
      status: "QUEUED",
      market: "AU",
      error: null,
      importedCount: 0,
      queries: {
        schemaVersion: 2,
        market: "AU",
        title: "Software Engineer",
        baseQueries: ["Software Engineer"],
        queries: ["Software Engineer", "Backend Engineer"],
        location: "Sydney",
        hoursOld: 48,
        resultsWanted: null,
        smartExpand: true,
        includeFromQueries: true,
        titleMatch: "relaxed",
        policy: {
          id: "au-recall-safe-v1",
          seniorityCeiling: "mid",
          seniorityEvidence: "visible-title-only",
          citizenshipOrPr: "exclude-explicit-required",
          governmentSecurityClearance:
            "exclude-required-or-explicitly-eligible-to-obtain",
          experienceYears: "never-exclude",
        },
        source: "jobspy",
      },
      location: "Sydney",
      hoursOld: 48,
      resultsWanted: null,
      includeFromQueries: true,
      filterDescription: true,
    });

    const response = await getConfig();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.run.config).toMatchObject({
      schemaVersion: 2,
      market: "AU",
      titleMatch: "relaxed",
      policy: { id: "au-recall-safe-v1" },
    });
    expect(body.run.queries).toEqual(body.run.config);
    expect(body.run.includeFromQueries).toBe(true);
    expect(body.run.filterDescription).toBe(true);
  });

  it("returns the active v2 policy snapshot through the real worker config route", async () => {
    harness.findUnique.mockResolvedValue({
      id: RUN_ID,
      status: "QUEUED",
      market: "AU",
      error: null,
      importedCount: 0,
      queries: {
        schemaVersion: 2,
        market: "AU",
        title: "Software Engineer",
        baseQueries: ["Software Engineer"],
        queries: ["Software Engineer", "Backend Engineer"],
        location: "Sydney",
        hoursOld: 48,
        resultsWanted: null,
        smartExpand: true,
        includeFromQueries: true,
        titleMatch: "relaxed",
        policy: AU_FETCH_POLICY,
        source: "jobspy",
      },
      location: "Sydney",
      hoursOld: 48,
      resultsWanted: null,
      includeFromQueries: true,
      filterDescription: true,
    });

    const response = await getConfig();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.run.config).toMatchObject({
      schemaVersion: 2,
      market: "AU",
      policy: {
        id: "au-recall-safe-v2",
        seniorityCeiling: "senior",
      },
    });
    expect(body.run.queries).toEqual(body.run.config);
    expect(body.run.includeFromQueries).toBe(true);
    expect(body.run.filterDescription).toBe(true);
  });

  it("rejects a request without the worker secret", async () => {
    const response = await getConfig("wrong-secret");

    expect(response.status).toBe(401);
    expect(harness.findUnique).not.toHaveBeenCalled();
  });

  it("fails closed when a versioned row violates its contract", async () => {
    harness.findUnique.mockResolvedValue({
      id: RUN_ID,
      status: "QUEUED",
      market: "AU",
      error: null,
      importedCount: 0,
      queries: {
        schemaVersion: 1,
        market: "AU",
        title: "Software Engineer",
      },
      location: null,
      hoursOld: null,
      resultsWanted: null,
      includeFromQueries: true,
      filterDescription: true,
    });

    const response = await getConfig();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_FETCH_RUN_CONFIG" },
    });
    expect(harness.reportError).toHaveBeenCalledOnce();
  });
});
