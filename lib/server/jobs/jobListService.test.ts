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
import { computeSimHash64 } from "./simHash";

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
  source: "jobspy",
  postingRisk: 25,
  postingRiskFlags: ["suspicious_domain", 42],
  fitVerdict: "STRONG",
  fitEligibility: "PASS",
  companyRoleKey: null,
  descriptionSimHash: null,
  livenessStatus: "ACTIVE",
  livenessReason: null,
  createdAt: new Date("2026-07-19T00:00:00.000Z"),
  updatedAt: new Date("2026-07-20T00:00:00.000Z"),
  market: "AU",
  applications: [],
};

const editableAiContent = {
  schemaVersion: 1,
  generatedAt: "2026-08-10T00:00:00.000Z",
  promptMetaHash: "prompt-hash",
  cv: {
    summary: {
      aiText: "Platform engineer.",
      originalText: "Engineer.",
      accepted: true,
    },
    latestExperience: { experienceIndex: 0, addedBullets: [] },
  },
  cover: {
    paragraphOne: { aiText: "One", accepted: true },
    paragraphTwo: { aiText: "Two", accepted: true },
    paragraphThree: { aiText: "Three", accepted: true },
  },
};

describe("listJobs market visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.job.findMany.mockResolvedValue([row]);
    prismaMock.job.count.mockResolvedValue(1);
  });

  it("queries only AU rows for the AU workspace", async () => {
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
          market: { in: ["AU"] },
        },
        select: expect.objectContaining({
          source: true,
          postingRisk: true,
          postingRiskFlags: true,
        }),
      }),
    );
    expect(prismaMock.job.count).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        status: "NEW",
        market: { in: ["AU"] },
      },
    });
    expect(result.items[0]).toMatchObject({
      market: "AU",
      source: "jobspy",
      postingRisk: 25,
      postingRiskFlags: ["suspicious_domain"],
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

  it("projects only the Application identity needed to open Review & Edit", async () => {
    prismaMock.job.findMany.mockResolvedValueOnce([
      {
        ...row,
        applications: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            aiContent: editableAiContent,
            resumePdfUrl: "https://example.com/cv.pdf",
            resumePdfName: "Alex Platform Engineer_CV.pdf",
            coverPdfUrl: "https://example.com/cl.pdf",
          },
        ],
      },
    ]);

    const result = await listJobs("user-1", {
      limit: 10,
      sort: "newest",
      market: "AU",
    });

    expect(result.items[0]).toMatchObject({
      applicationId: "22222222-2222-4222-8222-222222222222",
      resumePdfUrl: "https://example.com/cv.pdf",
      coverPdfUrl: "https://example.com/cl.pdf",
    });
    expect(result.items[0]).not.toHaveProperty("aiContent");
    expect(prismaMock.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          applications: expect.objectContaining({
            where: { userId: "user-1" },
            take: 1,
          }),
        }),
      }),
    );
  });

  it.each([
    ["missing", null],
    ["invalid", { schemaVersion: 1 }],
  ])(
    "keeps legacy PDFs downloadable but withholds the Review identity for %s AI Content",
    async (_case, aiContent) => {
      prismaMock.job.findMany.mockResolvedValueOnce([
        {
          ...row,
          applications: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              aiContent,
              resumePdfUrl: "https://example.com/legacy-cv.pdf",
              resumePdfName: "Legacy CV.pdf",
              coverPdfUrl: "https://example.com/legacy-cl.pdf",
            },
          ],
        },
      ]);

      const result = await listJobs("user-1", {
        limit: 10,
        sort: "newest",
        market: "AU",
      });

      expect(result.items[0]).toMatchObject({
        applicationId: null,
        resumePdfUrl: "https://example.com/legacy-cv.pdf",
        resumePdfName: "Legacy CV.pdf",
        coverPdfUrl: "https://example.com/legacy-cl.pdf",
      });
      expect(result.items[0]).not.toHaveProperty("aiContent");
    },
  );

  it("uses the persisted description SimHash to expose cross-source duplicates", async () => {
    const fingerprint = computeSimHash64(
      "Build reliable TypeScript APIs for distributed systems.",
    )!;
    prismaMock.job.findMany
      .mockResolvedValueOnce([{ ...row, descriptionSimHash: fingerprint }])
      .mockResolvedValueOnce([
        {
          id: "22222222-2222-2222-2222-222222222222",
          descriptionSimHash: fingerprint,
          createdAt: row.createdAt,
        },
      ]);

    const result = await listJobs("user-1", {
      limit: 10,
      sort: "newest",
      market: "AU",
    });

    expect(result.items[0]?.possibleDuplicate).toBe(true);
    expect(result.items[0]).not.toHaveProperty("descriptionSimHash");
  });
});
