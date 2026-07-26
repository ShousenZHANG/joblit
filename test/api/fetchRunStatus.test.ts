import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRunStore = vi.hoisted(() => ({
  findFirst: vi.fn(),
  commitFetchRun: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    fetchRun: fetchRunStore,
  },
}));

vi.mock("@/lib/server/fetchRuns/fetchRunCommit", () => ({
  FETCH_RUN_COMMIT_PROTOCOL: "fetch-run-commit/v1",
  FetchRunCommitError: class FetchRunCommitError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  },
  commitFetchRun: fetchRunStore.commitFetchRun,
}));

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "next-auth/next";
import { GET } from "@/app/api/fetch-runs/[id]/route";

const RUN_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("fetch run status api", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    fetchRunStore.findFirst.mockReset();
    fetchRunStore.commitFetchRun.mockReset().mockResolvedValue({
      disposition: "APPLIED",
      batchImported: 0,
      batchInvalid: 0,
      totalImported: 0,
      status: "FAILED",
    });
  });

  it("returns resolved query terms for UI progress transparency", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    fetchRunStore.findFirst.mockResolvedValueOnce({
      id: RUN_ID,
      status: "RUNNING",
      importedCount: 0,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      queries: {
        title: "Software Engineer",
        queries: ["Software Engineer", "Frontend Engineer", "Backend Engineer"],
        smartExpand: true,
      },
    });

    const res = await GET(new Request(`http://localhost/api/fetch-runs/${RUN_ID}`), {
      params: Promise.resolve({ id: RUN_ID }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.run.queryTitle).toBe("Software Engineer");
    expect(json.run.queryTerms).toEqual([
      "Software Engineer",
      "Frontend Engineer",
      "Backend Engineer",
    ]);
    expect(json.run.smartExpand).toBe(true);
    expect(fetchRunStore.commitFetchRun).not.toHaveBeenCalled();
  });

  it("lazily marks the requested stale active run failed before returning it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T03:00:00.000Z"));
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    const staleRun = {
      id: RUN_ID,
      status: "RUNNING",
      importedCount: 0,
      error: null,
      createdAt: new Date("2026-07-20T02:00:00.000Z"),
      updatedAt: new Date("2026-07-20T02:20:00.000Z"),
      queries: { title: "Software Engineer", queries: ["Software Engineer"] },
    };
    fetchRunStore.findFirst
      .mockResolvedValueOnce(staleRun)
      .mockResolvedValueOnce({
        ...staleRun,
        status: "FAILED",
        error: "Dispatch timeout: worker did not report status within 30 minutes",
        updatedAt: new Date("2026-07-20T03:00:00.000Z"),
      });

    const res = await GET(new Request(`http://localhost/api/fetch-runs/${RUN_ID}`), {
      params: Promise.resolve({ id: RUN_ID }),
    });
    const json = await res.json();

    expect(fetchRunStore.commitFetchRun).toHaveBeenCalledWith({
      protocol: "fetch-run-commit/v1",
      command: "fail",
      runId: RUN_ID,
      error: "Dispatch timeout: worker did not report status within 30 minutes",
      staleBefore: new Date("2026-07-20T02:30:00.000Z"),
    });
    expect(json.run.status).toBe("FAILED");
    expect(json.run.error).toContain("30 minutes");
    vi.useRealTimers();
  });
});
