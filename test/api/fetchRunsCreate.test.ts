import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRunStore = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    fetchRun: fetchRunStore,
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ fetchRun: fetchRunStore }),
  },
}));
vi.mock("@/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/fetch-runs/route";

describe("fetch runs create api", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    fetchRunStore.create.mockReset().mockResolvedValue({ id: "run-1" });
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

  it("derives ownership from the session without persisting email", async () => {
    signIn();
    const response = await postRun({ title: "Software Engineer" });
    expect(response.status).toBe(201);
    const data = fetchRunStore.create.mock.calls[0]?.[0]?.data;
    expect(data.userId).toBe("user-1");
    expect(data.market).toBe("AU");
    expect(data).not.toHaveProperty("userEmail");
  });

  it.each(["CN", "GLOBAL"])(
    "returns 410 and creates nothing for retired %s fetch",
    async (market) => {
      signIn();
      const response = await postRun({ market, queries: ["Engineer"] });
      expect(response.status).toBe(410);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "FETCH_MARKET_RETIRED" },
      });
      expect(fetchRunStore.create).not.toHaveBeenCalled();
    },
  );

  it("stores the server-owned AU recall policy despite stale knobs", async () => {
    signIn();
    const response = await postRun({
      market: "AU",
      title: "Software Engineer",
      smartExpand: false,
      includeFromQueries: false,
      titleMatch: "off",
      applyExcludes: false,
      excludeTitleTerms: ["intern"],
    });
    expect(response.status).toBe(201);
    const data = fetchRunStore.create.mock.calls[0]?.[0]?.data;
    expect(data.queries).toMatchObject({
      schemaVersion: 2,
      market: "AU",
      smartExpand: true,
      includeFromQueries: true,
      titleMatch: "relaxed",
      policy: {
        id: "au-recall-safe-v2",
        seniorityCeiling: "senior",
        experienceYears: "never-exclude",
      },
    });
    expect(data.queries).not.toHaveProperty("applyExcludes");
    expect(data.includeFromQueries).toBe(true);
    expect(data.filterDescription).toBe(true);
  });

  it("expands one AU role and stores the original as base intent", async () => {
    signIn();
    const response = await postRun({
      title: "Software Engineer",
      location: "Sydney",
    });
    expect(response.status).toBe(201);
    const config = fetchRunStore.create.mock.calls[0]?.[0]?.data?.queries;
    expect(config.baseQueries).toEqual(["Software Engineer"]);
    expect(config.queries).toContain("Forward Deployed Engineer");
    expect(config.queries).toContain("Full Stack Engineer");
  });

  it("trims and deduplicates bounded AU queries", async () => {
    signIn();
    const response = await postRun({
      title: " Software Engineer ",
      location: " Sydney ",
      queries: [" Java Developer ", "java developer"],
    });
    expect(response.status).toBe(201);
    const data = fetchRunStore.create.mock.calls[0]?.[0]?.data;
    expect(data.queries.title).toBe("Software Engineer");
    expect(data.queries.baseQueries).toEqual(["Java Developer"]);
    expect(data.location).toBe("Sydney");
  });

  it("rejects oversized AU input", async () => {
    signIn();
    for (const body of [
      { title: "x".repeat(121) },
      { title: "Engineer", location: "x".repeat(161) },
      { title: "Engineer", queries: ["x".repeat(121)] },
      {
        title: "Engineer",
        queries: Array.from({ length: 13 }, (_, index) => `role-${index}`),
      },
    ]) {
      expect((await postRun(body)).status).toBe(400);
    }
    expect(fetchRunStore.create).not.toHaveBeenCalled();
  });

  it("caps expansion at 24 while preserving original queries", async () => {
    signIn();
    const originals = [
      "Software Engineer",
      "Backend Engineer",
      "Full Stack Engineer",
      "AI Engineer",
      "Power Platform Developer",
      "Data Engineer",
    ];
    expect(
      (await postRun({ title: originals[0], queries: originals })).status,
    ).toBe(201);
    const config = fetchRunStore.create.mock.calls[0]?.[0]?.data?.queries;
    expect(config.queries.length).toBeLessThanOrEqual(24);
    expect(config.queries).toEqual(expect.arrayContaining(originals));
    expect(config.baseQueries).toEqual(originals);
  });

  it("ignores resultsWanted and stores full-fetch mode", async () => {
    signIn();
    expect(
      (await postRun({ title: "Software Engineer", resultsWanted: 5000 })).status,
    ).toBe(201);
    expect(fetchRunStore.create.mock.calls[0]?.[0]?.data.resultsWanted).toBeNull();
  });
});
