import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRunStore = vi.hoisted(() => ({
  create: vi.fn(),
  count: vi.fn(),
  executeRawLock: vi.fn(),
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

import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/fetch-runs/route";

describe("fetch runs create api", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    fetchRunStore.create.mockReset();
    fetchRunStore.count.mockReset();
    fetchRunStore.executeRawLock.mockReset();
    fetchRunStore.create.mockResolvedValue({ id: "run-1" });
    fetchRunStore.count.mockResolvedValue(0);
    fetchRunStore.executeRawLock.mockResolvedValue(1);
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

  it("returns a structured 429 without creating when persistent quota is exhausted", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });
    fetchRunStore.count.mockResolvedValueOnce(2);

    const res = await POST(
      new Request("http://localhost/api/fetch-runs", {
        method: "POST",
        body: JSON.stringify({ title: "Software Engineer" }),
      }),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "FETCH_RUN_QUOTA_EXCEEDED",
        message: "Free fetch capacity is busy right now. Try again shortly.",
        reason: "USER_ACTIVE_LIMIT",
        limit: 2,
      },
    });
    expect(fetchRunStore.create).not.toHaveBeenCalled();
  });
});
