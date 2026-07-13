import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRunStore = vi.hoisted(() => ({
  create: vi.fn(),
  count: vi.fn(),
  queryRawLock: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    fetchRun: fetchRunStore,
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        fetchRun: fetchRunStore,
        $queryRaw: fetchRunStore.queryRawLock,
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
    fetchRunStore.queryRawLock.mockReset();
    fetchRunStore.create.mockResolvedValue({ id: "run-1" });
    fetchRunStore.count.mockResolvedValue(0);
    fetchRunStore.queryRawLock.mockResolvedValue([{ pg_advisory_xact_lock: null }]);
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
    expect(payload.queries).toContain("Forward Deployed Engineer");
    expect(payload.queries).toContain("Full Stack Engineer");
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
    expect(payload.queries).toEqual(["Software Engineer"]);
    expect(payload.smartExpand).toBe(false);
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
