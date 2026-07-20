import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: { job: { findMany: store.findMany } },
}));
vi.mock("@/lib/server/observability/errorReporter", () => ({
  reportError: vi.fn(),
}));

import { computeSimHash64 } from "@/lib/server/jobs/simHash";
import { findNearDuplicateJobIds } from "@/lib/server/jobs/simHashDuplicateService";

describe("SimHash duplicate consumption", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.findMany.mockResolvedValue([]);
  });

  it("marks a visible row when a nearby persisted description matches", async () => {
    const fingerprint = computeSimHash64(
      "Build reliable TypeScript APIs for distributed systems.",
    )!;
    store.findMany.mockResolvedValue([
      {
        id: "other",
        descriptionSimHash: fingerprint,
        createdAt: new Date("2026-07-01T00:00:00Z"),
      },
    ]);

    const result = await findNearDuplicateJobIds("user-1", [
      {
        id: "visible",
        descriptionSimHash: fingerprint,
        createdAt: new Date("2026-07-20T00:00:00Z"),
      },
    ]);

    expect(result).toEqual(new Set(["visible"]));
    expect(store.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          descriptionSimHash: { not: null },
        }),
        take: 10_001,
      }),
    );
  });

  it("skips the candidate query when visible rows have no fingerprint", async () => {
    await expect(
      findNearDuplicateJobIds("user-1", [
        {
          id: "visible",
          descriptionSimHash: null,
          createdAt: new Date("2026-07-20T00:00:00Z"),
        },
      ]),
    ).resolves.toEqual(new Set());
    expect(store.findMany).not.toHaveBeenCalled();
  });
});
