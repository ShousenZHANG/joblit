import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRunStore = vi.hoisted(() => ({
  getFetchRunStatus: vi.fn(),
}));

vi.mock("@/lib/server/fetchRuns/fetchRun", () => ({
  getFetchRunStatus: fetchRunStore.getFetchRunStatus,
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
    fetchRunStore.getFetchRunStatus.mockReset();
  });

  it("returns resolved query terms for UI progress transparency", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    fetchRunStore.getFetchRunStatus.mockResolvedValueOnce({
      id: RUN_ID,
      status: "RUNNING",
      importedCount: 0,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      queryTitle: "Software Engineer",
      queryTerms: ["Software Engineer", "Frontend Engineer", "Backend Engineer"],
      smartExpand: true,
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
    expect(fetchRunStore.getFetchRunStatus).toHaveBeenCalledWith({
      runId: RUN_ID,
      userId: "user-1",
    });
  });

  it("returns the module's recovered stale status projection", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    fetchRunStore.getFetchRunStatus.mockResolvedValueOnce({
      id: RUN_ID,
      status: "FAILED",
      importedCount: 0,
      error: "Dispatch timeout: worker did not report status within 30 minutes",
      createdAt: new Date("2026-07-20T02:00:00.000Z"),
      updatedAt: new Date("2026-07-20T03:00:00.000Z"),
      queryTitle: "Software Engineer",
      queryTerms: ["Software Engineer"],
      smartExpand: true,
    });

    const res = await GET(new Request(`http://localhost/api/fetch-runs/${RUN_ID}`), {
      params: Promise.resolve({ id: RUN_ID }),
    });
    const json = await res.json();

    expect(json.run.status).toBe("FAILED");
    expect(json.run.error).toContain("30 minutes");
  });
});
