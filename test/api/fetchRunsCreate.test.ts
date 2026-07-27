import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRunStore = vi.hoisted(() => ({
  create: vi.fn(),
  count: vi.fn(),
  updateMany: vi.fn(),
  executeRawLock: vi.fn(),
  loadAtsAdapters: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    fetchRun: fetchRunStore,
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        fetchRun: fetchRunStore,
        $executeRaw: fetchRunStore.executeRawLock,
      }),
  },
}));

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));
vi.mock("@/lib/server/sources/atsBoardStore", () => ({
  loadEnabledAtsBoardAdapters: fetchRunStore.loadAtsAdapters,
}));

import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/fetch-runs/route";

describe("fetch runs create api", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    fetchRunStore.create.mockReset();
    fetchRunStore.count.mockReset();
    fetchRunStore.updateMany.mockReset().mockResolvedValue({ count: 0 });
    fetchRunStore.executeRawLock.mockReset();
    fetchRunStore.create.mockResolvedValue({ id: "run-1" });
    fetchRunStore.count.mockResolvedValue(0);
    fetchRunStore.executeRawLock.mockResolvedValue(1);
    fetchRunStore.loadAtsAdapters.mockReset().mockResolvedValue({
      boards: [],
      adapters: [],
      issues: [],
    });
  });

  function signIn() {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });
  }

  function postRun(body: Record<string, unknown>) {
    return POST(
      new Request("http://localhost/api/fetch-runs", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
  }

  it("derives ownership from the session id without persisting an email snapshot", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });

    const res = await postRun({ title: "Software Engineer" });

    expect(res.status).toBe(201);
    const data = fetchRunStore.create.mock.calls[0]?.[0]?.data;
    expect(data.userId).toBe("user-1");
    expect(data).not.toHaveProperty("userEmail");
  });

  it("creates a GLOBAL run with the requested sources", async () => {
    signIn();

    const res = await postRun({
      market: "GLOBAL",
      queries: ["AI Engineer"],
      hoursOld: 24,
      applyExcludes: true,
      excludeTitleTerms: ["intern"],
      excludeDescriptionRules: [
        "identity_requirement",
        "experience_requirement_4_plus",
      ],
      sources: ["remoteok", "jobicy"],
      sourceSelection: "explicit",
    });

    expect(res.status).toBe(201);
    const data = fetchRunStore.create.mock.calls[0]?.[0]?.data;
    expect(data.market).toBe("GLOBAL");
    expect(data.queries).toMatchObject({
      schemaVersion: 1,
      market: "GLOBAL",
      title: "AI Engineer",
      baseQueries: ["AI Engineer"],
      queries: expect.arrayContaining(["AI Engineer", "Machine Learning Engineer"]),
      hoursOld: 24,
      applyExcludes: true,
      excludeTitleTerms: ["intern"],
      excludeDescriptionRules: [
        "identity_requirement",
        "experience_requirement_4_plus",
      ],
      sources: ["remoteok", "jobicy"],
    });
    // No GitHub Actions dispatch for this market — it runs in-process.
    expect(data.location).toBeNull();
    expect(data.hoursOld).toBe(24);
    expect(data.includeFromQueries).toBe(true);
    expect(data.filterDescription).toBe(true);
  });

  it("turns off every GLOBAL exclusion when applyExcludes is false", async () => {
    signIn();

    const res = await postRun({
      market: "GLOBAL",
      queries: ["Software Engineer"],
      applyExcludes: false,
      excludeTitleTerms: ["intern"],
      excludeDescriptionRules: ["identity_requirement"],
    });

    expect(res.status).toBe(201);
    const data = fetchRunStore.create.mock.calls[0]?.[0]?.data;
    expect(data.queries).toMatchObject({
      applyExcludes: false,
      excludeTitleTerms: [],
      excludeDescriptionRules: [],
    });
    expect(data.filterDescription).toBe(false);
  });

  it("does not expand GLOBAL roles when smartExpand is false", async () => {
    signIn();

    const res = await postRun({
      market: "GLOBAL",
      queries: ["Software Engineer"],
      smartExpand: false,
    });

    expect(res.status).toBe(201);
    expect(fetchRunStore.create.mock.calls[0]?.[0]?.data.queries).toMatchObject({
      queries: ["Software Engineer"],
      smartExpand: false,
    });
  });

  it("rejects an unknown source id", async () => {
    signIn();

    const res = await postRun({
      market: "GLOBAL",
      queries: ["AI Engineer"],
      sources: ["definitely-not-a-source"],
    });

    expect(res.status).toBe(400);
    expect(fetchRunStore.create).not.toHaveBeenCalled();
  });

  it("accepts an enabled DB-backed ATS source id", async () => {
    signIn();
    fetchRunStore.loadAtsAdapters.mockResolvedValueOnce({
      boards: [],
      adapters: [{ id: "ats:greenhouse:acme" }],
      issues: [],
    });

    const res = await postRun({
      market: "GLOBAL",
      queries: ["AI Engineer"],
      sources: ["ats:greenhouse:acme"],
    });

    expect(res.status).toBe(201);
    expect(fetchRunStore.create.mock.calls[0]?.[0]?.data.queries).toMatchObject({
      sources: ["ats:greenhouse:acme"],
      sourceSelection: "explicit",
    });
  });

  it("rejects a well-formed ATS source id that is not enabled", async () => {
    signIn();

    const res = await postRun({
      market: "GLOBAL",
      queries: ["AI Engineer"],
      sources: ["ats:greenhouse:not-enabled"],
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "INVALID_SOURCE" },
    });
    expect(fetchRunStore.create).not.toHaveBeenCalled();
  });

  it("defaults a GLOBAL run to every registered source", async () => {
    signIn();

    const res = await postRun({ market: "GLOBAL", queries: ["AI Engineer"] });

    expect(res.status).toBe(201);
    expect(fetchRunStore.create.mock.calls[0]?.[0]?.data.queries).toMatchObject({
      sources: ["remoteok", "remotive", "jobicy"],
      sourceSelection: "all",
    });
  });

  it("rejects an implicit all-source run that cannot fit the serverless budget", async () => {
    signIn();
    fetchRunStore.loadAtsAdapters.mockResolvedValueOnce({
      boards: [],
      adapters: Array.from({ length: 22 }, (_, index) => ({
        id: `ats:greenhouse:company-${index}`,
      })),
      issues: [],
    });

    const res = await postRun({ market: "GLOBAL", queries: ["AI Engineer"] });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: {
        code: "SOURCE_LIMIT_EXCEEDED",
        details: { configured: 25, limit: 24 },
      },
    });
    expect(fetchRunStore.create).not.toHaveBeenCalled();
  });

  it("rejects an unfiltered GLOBAL feed import", async () => {
    signIn();

    const res = await postRun({ market: "GLOBAL" });

    expect(res.status).toBe(400);
    expect(fetchRunStore.create).not.toHaveBeenCalled();
  });

  it("auto expands a single role query by default", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });

    const res = await POST(
      new Request("http://localhost/api/fetch-runs", {
        method: "POST",
        body: JSON.stringify({
          title: "Software Engineer",
          location: "Sydney",
        }),
      }),
    );

    expect(res.status).toBe(201);
    const payload = fetchRunStore.create.mock.calls[0]?.[0]?.data?.queries;
    expect(payload.schemaVersion).toBe(1);
    expect(payload.market).toBe("AU");
    expect(payload.title).toBe("Software Engineer");
    expect(payload.baseQueries).toEqual(["Software Engineer"]);
    expect(payload.queries).toContain("Forward Deployed Engineer");
    expect(payload.queries).toContain("Full Stack Engineer");
    expect(payload.includeFromQueries).toBe(true);
  });

  it("can disable smart expand to keep only original query", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });

    await POST(
      new Request("http://localhost/api/fetch-runs", {
        method: "POST",
        body: JSON.stringify({
          title: "Software Engineer",
          smartExpand: false,
        }),
      }),
    );

    const payload = fetchRunStore.create.mock.calls[0]?.[0]?.data?.queries;
    expect(payload.baseQueries).toEqual(["Software Engineer"]);
    expect(payload.queries).toEqual(["Software Engineer"]);
    expect(payload.smartExpand).toBe(false);
  });

  it("trims and deduplicates bounded AU queries", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });

    const res = await POST(
      new Request("http://localhost/api/fetch-runs", {
        method: "POST",
        body: JSON.stringify({
          title: " Software Engineer ",
          location: " Sydney ",
          smartExpand: false,
          queries: [" Java Developer ", "java developer"],
        }),
      }),
    );

    expect(res.status).toBe(201);
    const data = fetchRunStore.create.mock.calls[0]?.[0]?.data;
    expect(data.queries.title).toBe("Software Engineer");
    expect(data.queries.queries).toEqual(["Java Developer"]);
    expect(data.location).toBe("Sydney");
  });

  it("rejects oversized AU query, title, location, and query count", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });

    const invalidBodies = [
      { title: "x".repeat(121) },
      { title: "Engineer", location: "x".repeat(161) },
      { title: "Engineer", queries: ["x".repeat(121)] },
      {
        title: "Engineer",
        queries: Array.from({ length: 13 }, (_, index) => `role-${index}`),
      },
    ];

    for (const body of invalidBodies) {
      const res = await POST(
        new Request("http://localhost/api/fetch-runs", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
      expect(res.status).toBe(400);
    }
    expect(fetchRunStore.create).not.toHaveBeenCalled();
  });

  it("caps smart-expanded AU queries while preserving every original query", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });
    const originals = [
      "Software Engineer",
      "Backend Engineer",
      "Full Stack Engineer",
      "AI Engineer",
      "Power Platform Developer",
      "Data Engineer",
    ];

    const res = await POST(
      new Request("http://localhost/api/fetch-runs", {
        method: "POST",
        body: JSON.stringify({
          title: originals[0],
          queries: originals,
          smartExpand: true,
        }),
      }),
    );

    expect(res.status).toBe(201);
    const queries = fetchRunStore.create.mock.calls[0]?.[0]?.data?.queries?.queries;
    const baseQueries =
      fetchRunStore.create.mock.calls[0]?.[0]?.data?.queries?.baseQueries;
    expect(queries.length).toBeLessThanOrEqual(24);
    expect(queries).toEqual(expect.arrayContaining(originals));
    expect(baseQueries).toEqual(originals);
  });

  it("normalizes and deduplicates bounded CN filters", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });

    const res = await POST(
      new Request("http://localhost/api/fetch-runs", {
        method: "POST",
        body: JSON.stringify({
          market: "CN",
          queries: [" 前端工程师 ", "前端工程师"],
          excludeKeywords: [" 实习 ", "实习"],
          locations: [" 上海 ", "上海"],
        }),
      }),
    );

    expect(res.status).toBe(201);
    const payload = fetchRunStore.create.mock.calls[0]?.[0]?.data?.queries;
    expect(payload.queries).toEqual(["前端工程师"]);
    expect(payload.excludeKeywords).toEqual(["实习"]);
    expect(payload.locations).toEqual(["上海"]);
  });

  it("rejects an unbounded CN query list before creating a run", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });

    const res = await POST(
      new Request("http://localhost/api/fetch-runs", {
        method: "POST",
        body: JSON.stringify({
          market: "CN",
          queries: Array.from({ length: 13 }, (_, index) => `role-${index}`),
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(fetchRunStore.create).not.toHaveBeenCalled();
  });

  it("keeps supported experience-based description exclusions from payload", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });

    await POST(
      new Request("http://localhost/api/fetch-runs", {
        method: "POST",
          body: JSON.stringify({
            title: "Software Engineer",
          excludeDescriptionRules: ["identity_requirement", "experience_requirement_4_plus"],
        }),
      }),
    );

    const payload = fetchRunStore.create.mock.calls[0]?.[0]?.data?.queries;
    expect(payload.excludeDescriptionRules).toEqual([
      "identity_requirement",
      "experience_requirement_4_plus",
    ]);
  });

  it("strips deprecated 5+ years rule from payload", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });

    await POST(
      new Request("http://localhost/api/fetch-runs", {
        method: "POST",
        body: JSON.stringify({
          title: "Software Engineer",
          excludeDescriptionRules: [
            "identity_requirement",
            "experience_requirement_5_plus",
          ],
        }),
      }),
    );

    const payload = fetchRunStore.create.mock.calls[0]?.[0]?.data?.queries;
    expect(payload.excludeDescriptionRules).toEqual(["identity_requirement"]);
  });

  it("keeps only supported description exclusion rules", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });

    await POST(
      new Request("http://localhost/api/fetch-runs", {
        method: "POST",
        body: JSON.stringify({
          title: "Software Engineer",
          excludeDescriptionRules: [
            "identity_requirement",
            "clearance_requirement",
            "sponsorship_unavailable",
            "experience_requirement_4_plus",
            "exp_7",
          ],
        }),
      }),
    );

    const payload = fetchRunStore.create.mock.calls[0]?.[0]?.data?.queries;
    expect(payload.excludeDescriptionRules).toEqual([
      "identity_requirement",
      "clearance_requirement",
      "sponsorship_unavailable",
      "experience_requirement_4_plus",
    ]);
  });

  it("ignores resultsWanted input and stores null for full-fetch mode", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });

    const res = await POST(
      new Request("http://localhost/api/fetch-runs", {
        method: "POST",
        body: JSON.stringify({
          title: "Software Engineer",
          resultsWanted: 5000,
        }),
      }),
    );

    expect(res.status).toBe(201);
    const payload = fetchRunStore.create.mock.calls[0]?.[0]?.data;
    expect(payload.resultsWanted).toBeNull();
  });

  it("does not persist sourceOptions defaults (single-phase fetch)", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });

    const res = await POST(
      new Request("http://localhost/api/fetch-runs", {
        method: "POST",
        body: JSON.stringify({
          title: "Software Engineer",
        }),
      }),
    );

    expect(res.status).toBe(201);
    const payload = fetchRunStore.create.mock.calls[0]?.[0]?.data?.queries;
    expect(payload.sourceOptions).toBeUndefined();
  });

  // The quota is gone. It was sized for one FetchRun per fetch, but a submit
  // with global feeds enabled creates two — so one click consumed the entire
  // per-user active allowance of 2, and the hourly allowance of 6 permitted
  // three fetches an hour. It also reported all four of its limits with one
  // message, so a user could not tell whether to wait thirty seconds or an
  // hour, or whether the limit was theirs or the platform's.
  it("creates a run regardless of how many are already active", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });
    fetchRunStore.count.mockResolvedValue(99);

    const res = await POST(
      new Request("http://localhost/api/fetch-runs", {
        method: "POST",
        body: JSON.stringify({ title: "Software Engineer" }),
      }),
    );

    expect(res.status).toBe(201);
    expect(fetchRunStore.create).toHaveBeenCalled();
  });
});
