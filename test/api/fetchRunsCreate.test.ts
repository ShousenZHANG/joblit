import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRunStore = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    fetchRun: fetchRunStore,
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
    fetchRunStore.create.mockResolvedValue({ id: "run-1" });
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
    expect(payload.queries).toContain("Backend Engineer");
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

  it("drops experience-based description exclusions from payload", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });

    await POST(
      new Request("http://localhost/api/fetch-runs", {
        method: "POST",
        body: JSON.stringify({
          title: "Software Engineer",
          excludeDescriptionRules: ["identity_requirement", "exp_5"],
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
});
