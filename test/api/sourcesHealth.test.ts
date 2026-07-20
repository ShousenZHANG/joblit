import { beforeEach, describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => ({
  boardFindMany: vi.fn(),
  healthFindMany: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    atsBoardSource: { findMany: stores.boardFindMany },
    sourceHealth: { findMany: stores.healthFindMany },
  },
}));
vi.mock("@/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { GET } from "@/app/api/sources/health/route";

function request(query = "") {
  return new Request(`http://localhost/api/sources/health${query}`);
}

describe("GET /api/sources/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (
      getServerSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ user: { id: "user-source-health" } });
    stores.boardFindMany.mockResolvedValue([
      {
        sourceId: "ats:greenhouse:acme",
        provider: "greenhouse",
        boardToken: "acme-private-slug",
        company: "Acme",
        region: null,
        careersUrl: "https://careers.acme.example/jobs",
        enabled: true,
      },
    ]);
    stores.healthFindMany.mockResolvedValue([
      {
        source: "remoteok",
        status: "HEALTHY",
        consecutiveFailures: 0,
        lastCheckedAt: new Date("2026-07-20T00:00:00Z"),
        lastReachableAt: new Date("2026-07-20T00:00:00Z"),
        lastFailureAt: null,
        reason: "reachable",
      },
      {
        source: "ats:greenhouse:acme",
        status: "DEGRADED",
        consecutiveFailures: 1,
        lastCheckedAt: new Date("2026-07-20T01:00:00Z"),
        lastReachableAt: new Date("2026-07-19T00:00:00Z"),
        lastFailureAt: new Date("2026-07-20T01:00:00Z"),
        reason: "network",
      },
    ]);
  });

  it("returns a strict UI-ready view without board tokens or careers URLs", async () => {
    const response = await GET(request());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(json.requestId).toEqual(expect.any(String));
    expect(json.data).toMatchObject({
      sources: [
        {
          sourceId: "remoteok",
          kind: "core",
          label: "Remote OK",
          status: "HEALTHY",
        },
        {
          sourceId: "remotive",
          kind: "core",
          status: "UNKNOWN",
        },
        {
          sourceId: "jobicy",
          kind: "core",
          status: "UNKNOWN",
        },
        {
          sourceId: "ats:greenhouse:acme",
          kind: "ats",
          label: "Acme",
          provider: "greenhouse",
          status: "DEGRADED",
        },
      ],
      summary: {
        healthy: 1,
        degraded: 1,
        down: 0,
        unknown: 2,
      },
      configurationIssueCount: 0,
    });
    expect(JSON.stringify(json)).not.toContain("acme-private-slug");
    expect(JSON.stringify(json)).not.toContain("careers.acme.example");
  });

  it("requires an authenticated tenant session", async () => {
    (
      getServerSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(stores.boardFindMany).not.toHaveBeenCalled();
  });

  it("rejects unknown query parameters before database reads", async () => {
    const response = await GET(request("?includeSecrets=true"));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_QUERY" },
      requestId: expect.any(String),
    });
    expect(stores.boardFindMany).not.toHaveBeenCalled();
  });
});
