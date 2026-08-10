import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  // Relevance search resolves the same per-Job tailoring state as the plain
  // list path. An empty result keeps every row `idle`.
  applicationBatchTask: {
    findMany: vi.fn(async () => []),
  },
}));

vi.mock("@/lib/server/prisma", () => ({ prisma: prismaMock }));

import { listJobsWithRelevance } from "./jobSearchService";

type SqlFragment = {
  strings: readonly string[];
  values: readonly unknown[];
};

function isSqlFragment(value: unknown): value is SqlFragment {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as SqlFragment).strings) &&
    Array.isArray((value as SqlFragment).values)
  );
}

function renderSql(
  strings: readonly string[],
  values: readonly unknown[],
): string {
  return strings.reduce((output, part, index) => {
    const value = values[index];
    return `${output}${part}${
      isSqlFragment(value) ? renderSql(value.strings, value.values) : "?"
    }`;
  }, "");
}

function flattenValues(values: readonly unknown[]): unknown[] {
  return values.flatMap((value) =>
    isSqlFragment(value) ? flattenValues(value.values) : [value],
  );
}

describe("listJobsWithRelevance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: BigInt(0) }]);
  });

  it("applies state aliases and ranked cursor pagination", async () => {
    await listJobsWithRelevance("11111111-1111-4111-8111-111111111111", {
      limit: 20,
      cursor: "22222222-2222-4222-8222-222222222222",
      q: "engineer",
      location: "state:NSW",
      sort: "newest",
      market: "AU",
    });

    const call = prismaMock.$queryRaw.mock.calls[0] ?? [];
    const sql = renderSql(call[0] as readonly string[], call.slice(1));
    expect(sql).toContain('ranked."rowNumber" >');
    expect(sql).toMatch(
      /FROM "Application"\s+WHERE "jobId" = j\."id"\s+AND "userId" = j\."userId"/,
    );
    expect(flattenValues(call.slice(1))).toEqual(
      expect.arrayContaining([
        "%NSW%",
        "%New South Wales%",
        "%Sydney%",
        "22222222-2222-4222-8222-222222222222",
      ]),
    );
  });

  it("keeps legacy PDF pointers while withholding invalid AI Content from search results", async () => {
    prismaMock.$queryRaw.mockReset();
    prismaMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: "22222222-2222-4222-8222-222222222222",
          jobUrl: "https://example.com/jobs/legacy",
          title: "Platform Engineer",
          company: "Example",
          location: "Sydney",
          jobType: "Full-time",
          jobLevel: "Senior",
          salary: null,
          workArrangement: "Hybrid",
          listingDate: null,
          status: "NEW",
          market: "AU",
          source: "jobspy",
          postingRisk: null,
          postingRiskFlags: [],
          livenessStatus: "ACTIVE",
          livenessReason: null,
          possibleDuplicate: false,
          descriptionSimHash: null,
          createdAt: new Date("2026-08-09T00:00:00.000Z"),
          updatedAt: new Date("2026-08-10T00:00:00.000Z"),
          applicationId: "33333333-3333-4333-8333-333333333333",
          aiContent: { schemaVersion: 1 },
          resumePdfUrl: "https://example.com/legacy-cv.pdf",
          resumePdfName: "Legacy CV.pdf",
          coverPdfUrl: "https://example.com/legacy-cl.pdf",
        },
      ])
      .mockResolvedValueOnce([{ count: BigInt(1) }]);

    const result = await listJobsWithRelevance(
      "11111111-1111-4111-8111-111111111111",
      {
        limit: 20,
        q: "engineer",
        sort: "newest",
        market: "AU",
      },
    );

    expect(result.items[0]).toMatchObject({
      applicationId: null,
      resumePdfUrl: "https://example.com/legacy-cv.pdf",
      coverPdfUrl: "https://example.com/legacy-cl.pdf",
    });
    expect(result.items[0]).not.toHaveProperty("aiContent");
  });
});
