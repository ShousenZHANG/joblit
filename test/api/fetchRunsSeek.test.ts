import { afterEach, describe, expect, it, vi } from "vitest";

const prismaStore = vi.hoisted(() => ({
  fetchRun: { create: vi.fn(), count: vi.fn() },
  // Seek creation runs inside an advisory-locked transaction; the mock runs the
  // callback against a tx that shares the same fetchRun mocks.
  $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
    cb({ $executeRaw: async () => 0, fetchRun: prismaStore.fetchRun }),
  ),
}));

vi.mock("@/lib/server/prisma", () => ({ prisma: prismaStore }));

// Replace only the session wrapper; keep the real parseJsonValue so the AUSchema
// (including the new source/classification/daterange + seek gating) is exercised.
vi.mock("@/lib/server/api/routeHandler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/api/routeHandler")>();
  return {
    ...actual,
    withEmailSessionRoute: (handler: (ctx: { userId: string; userEmail: string; requestId: string }) => unknown) =>
      handler({ userId: "u", userEmail: "e@x", requestId: "r" }),
  };
});

import { POST } from "@/app/api/fetch-runs/route";

function auReq(body: Record<string, unknown>) {
  return new Request("http://localhost/api/fetch-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ market: "AU", title: "Engineer", ...body }),
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("fetch-runs POST — Seek source gating", () => {
  it("rejects a seek run when the kill-switch is off", async () => {
    vi.stubEnv("SEEK_FETCH_ENABLED", "");
    const res = await POST(auReq({ source: "seek" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("SEEK_DISABLED");
    expect(prismaStore.fetchRun.create).not.toHaveBeenCalled();
  });

  it("rejects a second concurrent seek run (IP abuse guard)", async () => {
    vi.stubEnv("SEEK_FETCH_ENABLED", "true");
    prismaStore.fetchRun.count.mockResolvedValue(1);
    const res = await POST(auReq({ source: "seek" }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("SEEK_RUN_IN_PROGRESS");
    expect(prismaStore.fetchRun.create).not.toHaveBeenCalled();
  });

  it("creates a seek run and persists source + classification + filters", async () => {
    vi.stubEnv("SEEK_FETCH_ENABLED", "true");
    prismaStore.fetchRun.count.mockResolvedValue(0);
    prismaStore.fetchRun.create.mockResolvedValue({ id: "run-1" });
    const res = await POST(
      auReq({
        source: "seek",
        classification: "6281",
        subClassification: "6290",
        workType: "242",
        salaryMin: 120000,
        daterange: 3,
        smartExpand: false,
      }),
    );
    expect(res.status).toBe(201);
    const data = prismaStore.fetchRun.create.mock.calls[0][0].data;
    expect(data.queries.source).toBe("seek");
    expect(data.queries.classification).toBe("6281");
    expect(data.queries.subClassification).toBe("6290");
    expect(data.queries.workType).toBe("242");
    expect(data.queries.salaryMin).toBe(120000);
    expect(data.queries.daterange).toBe(3);
  });

  it("drops the subclassification when no parent category is chosen", async () => {
    vi.stubEnv("SEEK_FETCH_ENABLED", "true");
    prismaStore.fetchRun.count.mockResolvedValue(0);
    prismaStore.fetchRun.create.mockResolvedValue({ id: "run-3" });
    // subclass without a classification is meaningless — must not be persisted.
    const res = await POST(
      auReq({ source: "seek", subClassification: "6290", smartExpand: false }),
    );
    expect(res.status).toBe(201);
    const data = prismaStore.fetchRun.create.mock.calls[0][0].data;
    expect(data.queries.classification).toBe("");
    expect(data.queries.subClassification).toBe("");
  });

  it("rejects a non-numeric subclassification (URL-injection guard)", async () => {
    vi.stubEnv("SEEK_FETCH_ENABLED", "true");
    prismaStore.fetchRun.count.mockResolvedValue(0);
    const res = await POST(
      auReq({ source: "seek", classification: "6281", subClassification: "6290&x=1" }),
    );
    expect(res.status).toBe(400);
    expect(prismaStore.fetchRun.create).not.toHaveBeenCalled();
  });

  it("defaults to jobspy and skips the seek guard (backward compatible)", async () => {
    prismaStore.fetchRun.create.mockResolvedValue({ id: "run-2" });
    const res = await POST(auReq({ smartExpand: false }));
    expect(res.status).toBe(201);
    const data = prismaStore.fetchRun.create.mock.calls[0][0].data;
    expect(data.queries.source).toBe("jobspy");
    expect(prismaStore.fetchRun.count).not.toHaveBeenCalled();
  });
});
