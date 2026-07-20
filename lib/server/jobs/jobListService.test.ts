import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  job: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
}));

vi.mock("@/lib/server/prisma", () => ({ prisma: prismaMock }));
vi.mock("./jobSearchService", () => ({
  listJobsWithRelevance: vi.fn(),
}));

import { listJobs } from "./jobListService";

const row = {
  id: "11111111-1111-1111-1111-111111111111",
  jobUrl: "https://example.com/jobs/1",
  title: "Platform Engineer",
  company: "Example",
  location: "Remote",
  jobType: "Full-time",
  jobLevel: "Senior",
  salary: "$150k",
  workArrangement: "Remote",
  listingDate: new Date("2026-07-18T00:00:00.000Z"),
  status: "NEW",
  source: "remoteok",
  postingRisk: 25,
  postingRiskFlags: ["suspicious_domain", 42],
  fitScore: 82,
  fitVerdict: "STRONG",
  fitEligibility: "PASS",
  createdAt: new Date("2026-07-19T00:00:00.000Z"),
  updatedAt: new Date("2026-07-20T00:00:00.000Z"),
  market: "GLOBAL",
  applications: [],
};

describe("listJobs market visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.job.findMany.mockResolvedValue([row]);
    prismaMock.job.count.mockResolvedValue(1);
  });

  it("queries AU and GLOBAL rows for the AU workspace and returns fit fields", async () => {
    const result = await listJobs("user-1", {
      limit: 10,
      status: "NEW",
      sort: "newest",
      market: "AU",
    });

    expect(prismaMock.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-1",
          status: "NEW",
          market: { in: ["AU", "GLOBAL"] },
        },
        select: expect.objectContaining({
          source: true,
          postingRisk: true,
          postingRiskFlags: true,
          fitScore: true,
          fitVerdict: true,
          fitEligibility: true,
        }),
      }),
    );
    expect(prismaMock.job.count).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        status: "NEW",
        market: { in: ["AU", "GLOBAL"] },
      },
    });
    expect(result.items[0]).toMatchObject({
      market: "GLOBAL",
      source: "remoteok",
      postingRisk: 25,
      postingRiskFlags: ["suspicious_domain"],
      fitScore: 82,
      fitVerdict: "STRONG",
      fitEligibility: "PASS",
    });
  });

  it("queries only CN rows for the CN workspace", async () => {
    await listJobs("user-1", {
      limit: 10,
      sort: "newest",
      market: "CN",
    });

    expect(prismaMock.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-1",
          market: { in: ["CN"] },
        },
      }),
    );
  });
});
