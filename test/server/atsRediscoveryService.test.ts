import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    atsBoardSource: {
      updateMany: vi.fn(),
    },
  },
}));

import { recoverAtsBoardsAfter404 } from "@/lib/server/sources/atsRediscoveryService";
import type { AtsBoardConfig } from "@/lib/server/sources/atsBoards";
import type { RawSourceJob } from "@/lib/server/sources/types";

const BOARD: AtsBoardConfig = {
  id: "ats:greenhouse:acme",
  provider: "greenhouse",
  boardToken: "acme-old",
  company: "Acme",
  careersUrl: "https://careers.acme.example/jobs",
};

function recoveredJob(): RawSourceJob {
  return {
    jobUrl: "https://boards.greenhouse.io/acme-new/jobs/123",
    title: "Backend Engineer",
    company: "Acme",
    location: "Sydney",
    jobType: null,
    jobLevel: null,
    description: null,
    salary: null,
    workArrangement: null,
    listingDate: null,
    source: BOARD.id,
  };
}

describe("ATS rediscovery service", () => {
  it("claims, probes, persists, and returns recovered jobs in the same run", async () => {
    const attemptedAt = new Date("2026-07-20T00:00:00Z");
    const claimAttempt = vi.fn(async () => ({ attemptedAt }));
    const fetchCareersHtml = vi.fn(async () =>
      '<a href="https://boards.greenhouse.io/acme-new/jobs">Open roles</a>',
    );
    const fetchJobs = vi.fn(async () => [recoveredJob()]);
    const persistBoard = vi.fn(async () => true);

    const result = await recoverAtsBoardsAfter404({
      boards: [BOARD],
      diagnostics: [
        { source: BOARD.id, ok: false, raw: 0, error: "source fetch: HTTP 404" },
      ],
      now: attemptedAt,
      dependencies: {
        claimAttempt,
        fetchCareersHtml,
        fetchJobs,
        persistBoard,
      },
    });

    expect(result.errors).toEqual([]);
    expect(result.recovered).toEqual([
      {
        source: BOARD.id,
        config: { ...BOARD, boardToken: "acme-new" },
        jobs: [recoveredJob()],
      },
    ]);
    expect(fetchJobs).toHaveBeenCalledWith({
      ...BOARD,
      boardToken: "acme-new",
    });
    expect(persistBoard).toHaveBeenCalledWith(
      BOARD,
      {
        ...BOARD,
        boardToken: "acme-new",
      },
      { attemptedAt },
    );
  });

  it("does not rediscover non-404 failures or boards still in cooldown", async () => {
    const claimAttempt = vi.fn(async () => null);
    const fetchCareersHtml = vi.fn(async () => "");

    const network = await recoverAtsBoardsAfter404({
      boards: [BOARD],
      diagnostics: [
        { source: BOARD.id, ok: false, raw: 0, error: "ECONNRESET" },
      ],
      dependencies: { claimAttempt, fetchCareersHtml },
    });
    const coolingDown = await recoverAtsBoardsAfter404({
      boards: [BOARD],
      diagnostics: [
        { source: BOARD.id, ok: false, raw: 0, error: "HTTP 404" },
      ],
      dependencies: { claimAttempt, fetchCareersHtml },
    });

    expect(network).toEqual({ recovered: [], errors: [] });
    expect(coolingDown).toEqual({ recovered: [], errors: [] });
    expect(claimAttempt).toHaveBeenCalledTimes(1);
    expect(fetchCareersHtml).not.toHaveBeenCalled();
  });

  it("contains one board failure without rejecting the fetch run", async () => {
    const result = await recoverAtsBoardsAfter404({
      boards: [BOARD],
      diagnostics: [
        { source: BOARD.id, ok: false, raw: 0, error: "HTTP 410" },
      ],
      dependencies: {
        claimAttempt: async () => ({ attemptedAt: new Date() }),
        fetchCareersHtml: async () => {
          throw new Error("careers page HTTP 503");
        },
      },
    });

    expect(result).toEqual({
      recovered: [],
      errors: [
        { source: BOARD.id, message: "careers page HTTP 503" },
      ],
    });
  });
});
