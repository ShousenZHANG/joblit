import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
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

function renderSql(strings: readonly string[], values: readonly unknown[]): string {
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

  it("keeps fit-band filtering active when text search uses relevance SQL", async () => {
    await listJobsWithRelevance("11111111-1111-4111-8111-111111111111", {
      limit: 20,
      q: "platform engineer",
      sort: "newest",
      fitBand: "strong",
      market: "AU",
    });

    const call = prismaMock.$queryRaw.mock.calls[0] ?? [];
    const sql = renderSql(call[0] as readonly string[], call.slice(1));
    expect(sql).toContain('j."fitScore" >= 75');
    expect(sql).toContain('j."market" IN');
    expect(sql).toContain("ROW_NUMBER()");
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
    expect(flattenValues(call.slice(1))).toEqual(
      expect.arrayContaining([
        "%NSW%",
        "%New South Wales%",
        "%Sydney%",
        "22222222-2222-4222-8222-222222222222",
      ]),
    );
  });
});
