import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRunStore = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findFirstInTx: vi.fn(),
  updateInTx: vi.fn(),
  expireInTx: vi.fn(),
  updateMany: vi.fn(),
  queryRawLock: vi.fn(),
  executeRawLock: vi.fn(),
  countInTx: vi.fn(),
}));

const inlineProcessors = vi.hoisted(() => ({
  cn: vi.fn(),
  global: vi.fn(),
}));

const commitHarness = vi.hoisted(() => ({
  commitFetchRun: vi.fn(),
}));

const safeFetchHarness = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("@/lib/server/net/safeFetch", () => {
  class MockSafeOutboundError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "SafeOutboundError";
    }
  }
  return {
    SafeOutboundError: MockSafeOutboundError,
    safeOutboundFetch: safeFetchHarness.fetch,
  };
});

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    fetchRun: {
      findFirst: fetchRunStore.findFirst,
      updateMany: fetchRunStore.updateMany,
    },
    // $transaction hands a tx client with the same shape as `prisma`; we re-route
    // the tx's fetchRun calls to dedicated mocks so tests can assert them.
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        fetchRun: {
          findFirst: fetchRunStore.findFirstInTx,
          update: fetchRunStore.updateInTx,
          updateMany: fetchRunStore.expireInTx,
          count: fetchRunStore.countInTx,
        },
        $queryRaw: fetchRunStore.queryRawLock,
        $executeRaw: fetchRunStore.executeRawLock,
      };
      return cb(tx);
    },
  },
}));

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/server/cnFetch/processFetchRun", () => ({
  processCnFetchRun: inlineProcessors.cn,
}));

vi.mock("@/lib/server/sources/processGlobalFetchRun", () => ({
  processGlobalFetchRun: inlineProcessors.global,
}));

vi.mock("@/lib/server/fetchRuns/fetchRunCommit", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/server/fetchRuns/fetchRunCommit")>();
  return { ...original, commitFetchRun: commitHarness.commitFetchRun };
});

import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/fetch-runs/[id]/trigger/route";
import { SafeOutboundError } from "@/lib/server/net/safeFetch";

const RUN_ID = "550e8400-e29b-41d4-a716-446655440000";

function mockAuthedUser(userId = "user-1") {
  (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { id: userId },
  });
}

function mockLockAcquired(locked = true) {
  fetchRunStore.queryRawLock.mockResolvedValue([{ locked }]);
}

describe("fetch run trigger api", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    fetchRunStore.findFirst.mockReset();
    fetchRunStore.findFirst.mockResolvedValue({ id: RUN_ID });
    fetchRunStore.findFirstInTx.mockReset();
    fetchRunStore.updateInTx.mockReset();
    fetchRunStore.expireInTx.mockReset().mockResolvedValue({ count: 1 });
    fetchRunStore.updateMany.mockReset().mockResolvedValue({ count: 1 });
    fetchRunStore.queryRawLock.mockReset();
    fetchRunStore.executeRawLock.mockReset();
    fetchRunStore.executeRawLock.mockResolvedValue(1);
    fetchRunStore.countInTx.mockReset();
    fetchRunStore.countInTx.mockResolvedValue(0);
    inlineProcessors.cn.mockReset();
    inlineProcessors.global.mockReset();
    commitHarness.commitFetchRun.mockReset().mockResolvedValue({
      disposition: "APPLIED",
      batchImported: 0,
      batchInvalid: 0,
      totalImported: 0,
      status: "RUNNING",
    });
    safeFetchHarness.fetch
      .mockReset()
      .mockImplementation((url: string | URL, init?: RequestInit) =>
        fetch(url, init),
      );
    process.env.GITHUB_OWNER = "o";
    process.env.GITHUB_REPO = "r";
    process.env.GITHUB_TOKEN = "t";
    process.env.GITHUB_WORKFLOW_FILE = "jobspy-fetch.yml";
    process.env.GITHUB_REF = "master";
  });

  it("acquires advisory lock and dispatches GitHub workflow", async () => {
    mockAuthedUser();
    mockLockAcquired(true);
    fetchRunStore.findFirstInTx.mockResolvedValueOnce({
      id: RUN_ID,
      status: "QUEUED",
      market: "AU",
      queries: { title: "Software Engineer", queries: ["Software Engineer"] },
    });
    fetchRunStore.updateInTx.mockResolvedValueOnce({});
    fetchRunStore.updateMany.mockResolvedValue({ count: 1 });

    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(
      new Request(`http://localhost/api/fetch-runs/${RUN_ID}/trigger`, { method: "POST" }),
      { params: Promise.resolve({ id: RUN_ID }) },
    );

    expect(res.status).toBe(200);
    expect(fetchRunStore.queryRawLock).toHaveBeenCalled();
    expect(fetchRunStore.expireInTx).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();
    expect(safeFetchHarness.fetch).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/api\.github\.com\/repos\/o\/r\/actions\/workflows\/jobspy-fetch\.yml\/dispatches$/,
      ),
      expect.objectContaining({ method: "POST" }),
      {
        allowedHosts: ["api.github.com"],
        timeoutMs: 10_000,
        maxResponseBytes: 64 * 1024,
        maxRedirects: 0,
      },
    );
  });

  it("returns alreadyDispatched when advisory lock is contended", async () => {
    mockAuthedUser();
    mockLockAcquired(false); // competing request holds the lock

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(
      new Request(`http://localhost/api/fetch-runs/${RUN_ID}/trigger`, { method: "POST" }),
      { params: Promise.resolve({ id: RUN_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.alreadyDispatched).toBe(true);
    expect(fetchRunStore.findFirstInTx).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is idempotent when already dispatched (dispatchMeta flag set)", async () => {
    mockAuthedUser();
    mockLockAcquired(true);
    fetchRunStore.findFirstInTx.mockResolvedValueOnce({
      id: RUN_ID,
      status: "QUEUED",
      market: "AU",
      queries: {
        title: "Software Engineer",
        queries: ["Software Engineer"],
        dispatchMeta: { dispatchedAt: "2026-02-14T00:00:01.000Z" },
      },
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(
      new Request(`http://localhost/api/fetch-runs/${RUN_ID}/trigger`, { method: "POST" }),
      { params: Promise.resolve({ id: RUN_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.alreadyDispatched).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("replays prior result within idempotency window when Idempotency-Key matches", async () => {
    mockAuthedUser();
    mockLockAcquired(true);
    fetchRunStore.findFirstInTx.mockResolvedValueOnce({
      id: RUN_ID,
      status: "QUEUED",
      market: "AU",
      queries: {
        title: "SWE",
        queries: ["SWE"],
        dispatchMeta: {
          idempotencyKey: "client-key-abc",
          idempotencyAt: new Date().toISOString(),
          dispatchedAt: new Date().toISOString(),
        },
      },
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(
      new Request(`http://localhost/api/fetch-runs/${RUN_ID}/trigger`, {
        method: "POST",
        headers: { "Idempotency-Key": "client-key-abc" },
      }),
      { params: Promise.resolve({ id: RUN_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.idempotent).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 when run does not belong to user", async () => {
    mockAuthedUser();
    fetchRunStore.findFirst.mockResolvedValueOnce(null);

    const res = await POST(
      new Request(`http://localhost/api/fetch-runs/${RUN_ID}/trigger`, { method: "POST" }),
      { params: Promise.resolve({ id: RUN_ID }) },
    );
    expect(res.status).toBe(404);
    expect(fetchRunStore.queryRawLock).not.toHaveBeenCalled();
    expect(fetchRunStore.executeRawLock).not.toHaveBeenCalled();
  });

  it("returns 409 when run is not in QUEUED state", async () => {
    mockAuthedUser();
    mockLockAcquired(true);
    fetchRunStore.findFirstInTx.mockResolvedValueOnce({
      id: RUN_ID,
      status: "RUNNING",
      market: "AU",
      queries: {},
    });

    const res = await POST(
      new Request(`http://localhost/api/fetch-runs/${RUN_ID}/trigger`, { method: "POST" }),
      { params: Promise.resolve({ id: RUN_ID }) },
    );
    expect(res.status).toBe(409);
  });

  it("does not duplicate a fresh CN inline execution lease", async () => {
    mockAuthedUser("inline-fresh-user");
    mockLockAcquired(true);
    fetchRunStore.findFirstInTx.mockResolvedValueOnce({
      id: RUN_ID,
      status: "RUNNING",
      market: "CN",
      updatedAt: new Date(),
      executionAttemptId: "11111111-1111-4111-8111-111111111111",
      executionLeaseExpiresAt: new Date(Date.now() + 60_000),
      queries: {
        queries: ["Java Engineer"],
        sources: ["nowcoder"],
      },
    });

    const res = await POST(
      new Request(`http://localhost/api/fetch-runs/${RUN_ID}/trigger`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: RUN_ID }) },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      alreadyDispatched: true,
    });
    expect(fetchRunStore.expireInTx).not.toHaveBeenCalled();
    expect(fetchRunStore.countInTx).not.toHaveBeenCalled();
    expect(commitHarness.commitFetchRun).not.toHaveBeenCalled();
    expect(inlineProcessors.cn).not.toHaveBeenCalled();
  });

  it("reclaims an expired QUEUED inline claim after a pre-start process loss", async () => {
    mockAuthedUser("inline-prestart-user");
    mockLockAcquired(true);
    const expiredClaimAt = new Date(Date.now() - 95_000).toISOString();
    const originalQueries = {
      queries: ["Java Engineer"],
      sources: ["nowcoder"],
      dispatchMeta: {
        inFlightAt: expiredClaimAt,
        idempotencyKey: "same-inline-request",
        idempotencyAt: expiredClaimAt,
      },
    };
    fetchRunStore.findFirstInTx.mockResolvedValueOnce({
      id: RUN_ID,
      status: "QUEUED",
      market: "CN",
      updatedAt: new Date(),
      executionAttemptId: null,
      executionLeaseExpiresAt: null,
      queries: originalQueries,
    });
    inlineProcessors.cn.mockResolvedValueOnce({
      discovered: 1,
      imported: 1,
    });

    const res = await POST(
      new Request(`http://localhost/api/fetch-runs/${RUN_ID}/trigger`, {
        method: "POST",
        headers: { "Idempotency-Key": "same-inline-request" },
      }),
      { params: Promise.resolve({ id: RUN_ID }) },
    );

    expect(res.status).toBe(200);
    expect(commitHarness.commitFetchRun).toHaveBeenCalledWith({
      protocol: "fetch-run-commit/v1",
      command: "start",
      runId: RUN_ID,
      attemptId: expect.any(String),
    });
    const attemptId = commitHarness.commitFetchRun.mock.calls[0]?.[0]?.attemptId;
    expect(attemptId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(inlineProcessors.cn).toHaveBeenCalledWith(
      "inline-prestart-user",
      expect.objectContaining({
        id: RUN_ID,
        attemptId,
      }),
    );
  });

  it("reports executor supersession as a healthy handoff, not user cancellation", async () => {
    mockAuthedUser("inline-handoff-user");
    mockLockAcquired(true);
    fetchRunStore.findFirstInTx.mockResolvedValueOnce({
      id: RUN_ID,
      status: "QUEUED",
      market: "CN",
      updatedAt: new Date(),
      executionAttemptId: null,
      executionLeaseExpiresAt: null,
      queries: {
        queries: ["Java Engineer"],
        sources: ["nowcoder"],
      },
    });
    inlineProcessors.cn.mockResolvedValueOnce({
      discovered: 0,
      imported: 0,
      superseded: true,
    });

    const res = await POST(
      new Request(`http://localhost/api/fetch-runs/${RUN_ID}/trigger`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: RUN_ID }) },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      alreadyDispatched: true,
    });
  });

  it("reclaims an expired GLOBAL inline lease and resumes the RUNNING run", async () => {
    mockAuthedUser("inline-resume-user");
    mockLockAcquired(true);
    const originalQueries = {
      queries: ["AI Engineer"],
      sources: ["remoteok"],
      dispatchMeta: { dispatchedAt: "2020-01-01T00:00:00.000Z" },
    };
    fetchRunStore.findFirstInTx.mockResolvedValueOnce({
      id: RUN_ID,
      status: "RUNNING",
      market: "GLOBAL",
      queries: originalQueries,
    });
    inlineProcessors.global.mockResolvedValueOnce({
      discovered: 3,
      imported: 2,
    });

    const res = await POST(
      new Request(`http://localhost/api/fetch-runs/${RUN_ID}/trigger`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: RUN_ID }) },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      discovered: 3,
      imported: 2,
    });
    expect(fetchRunStore.expireInTx).toHaveBeenCalledWith({
      where: {
        id: RUN_ID,
        userId: "inline-resume-user",
        status: "RUNNING",
      },
      data: {
        queries: expect.objectContaining({
          dispatchMeta: expect.objectContaining({
            inFlightAt: expect.any(String),
            dispatchedAt: "2020-01-01T00:00:00.000Z",
          }),
        }),
      },
    });
    expect(commitHarness.commitFetchRun).toHaveBeenCalledWith({
      protocol: "fetch-run-commit/v1",
      command: "start",
      runId: RUN_ID,
      attemptId: expect.any(String),
    });
    const resumedAttemptId =
      commitHarness.commitFetchRun.mock.calls[0]?.[0]?.attemptId;
    expect(resumedAttemptId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(fetchRunStore.updateMany).toHaveBeenCalledWith({
      where: {
        id: RUN_ID,
        userId: "inline-resume-user",
        status: "RUNNING",
        executionAttemptId: resumedAttemptId,
      },
      data: {
        queries: expect.objectContaining({
          dispatchMeta: expect.objectContaining({
            inFlightAt: expect.any(String),
            dispatchedAt: "2020-01-01T00:00:00.000Z",
          }),
        }),
      },
    });
    expect(inlineProcessors.global).toHaveBeenCalledWith(
      "inline-resume-user",
      {
        id: RUN_ID,
        queries: originalQueries,
        attemptId: resumedAttemptId,
      },
    );
  });

  it("marks the run failed when GitHub rejects the dispatch", async () => {
    mockAuthedUser();
    mockLockAcquired(true);
    fetchRunStore.findFirstInTx.mockResolvedValueOnce({
      id: RUN_ID,
      status: "QUEUED",
      market: "AU",
      queries: { title: "SWE", queries: ["SWE"] },
    });
    fetchRunStore.updateInTx.mockResolvedValueOnce({});
    fetchRunStore.updateMany.mockResolvedValue({ count: 1 });

    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(
      new Request(`http://localhost/api/fetch-runs/${RUN_ID}/trigger`, { method: "POST" }),
      { params: Promise.resolve({ id: RUN_ID }) },
    );
    expect(res.status).toBe(502);
    expect(fetchRunStore.updateMany).not.toHaveBeenCalled();
    expect(fetchRunStore.expireInTx).toHaveBeenCalledWith({
      where: { id: RUN_ID, userId: "user-1", status: "QUEUED" },
      data: {
        status: "FAILED",
        error: "GITHUB_DISPATCH_FAILED",
        terminalAt: expect.any(Date),
        queries: { title: "SWE", queries: ["SWE"] },
      },
    });
    expect(fetchRunStore.executeRawLock).toHaveBeenCalled();
  });

  it("marks the run failed when AU dispatch configuration is missing", async () => {
    mockAuthedUser();
    mockLockAcquired(true);
    delete process.env.GITHUB_TOKEN;
    fetchRunStore.findFirstInTx.mockResolvedValueOnce({
      id: RUN_ID,
      status: "QUEUED",
      market: "AU",
      queries: { title: "SWE", queries: ["SWE"] },
    });
    fetchRunStore.updateInTx.mockResolvedValueOnce({});
    fetchRunStore.updateMany.mockResolvedValue({ count: 1 });

    const res = await POST(
      new Request(`http://localhost/api/fetch-runs/${RUN_ID}/trigger`, { method: "POST" }),
      { params: Promise.resolve({ id: RUN_ID }) },
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "GITHUB_DISPATCH_NOT_CONFIGURED",
        message: "GitHub dispatch is not configured",
      },
    });
    expect(fetchRunStore.expireInTx).toHaveBeenCalledWith({
      where: { id: RUN_ID, userId: "user-1", status: "QUEUED" },
      data: {
        status: "FAILED",
        error: "GITHUB_DISPATCH_NOT_CONFIGURED",
        terminalAt: expect.any(Date),
        queries: { title: "SWE", queries: ["SWE"] },
      },
    });
    expect(fetchRunStore.executeRawLock).toHaveBeenCalled();
  });

  it("marks the run failed when GitHub dispatch is unreachable", async () => {
    mockAuthedUser();
    mockLockAcquired(true);
    fetchRunStore.findFirstInTx.mockResolvedValueOnce({
      id: RUN_ID,
      status: "QUEUED",
      market: "AU",
      queries: { title: "SWE", queries: ["SWE"] },
    });
    fetchRunStore.updateInTx.mockResolvedValueOnce({});
    fetchRunStore.updateMany.mockResolvedValue({ count: 1 });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));

    const res = await POST(
      new Request(`http://localhost/api/fetch-runs/${RUN_ID}/trigger`, { method: "POST" }),
      { params: Promise.resolve({ id: RUN_ID }) },
    );

    expect(res.status).toBe(504);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "GITHUB_DISPATCH_UNREACHABLE",
        message: "GitHub dispatch is unreachable",
      },
    });
    expect(fetchRunStore.expireInTx).toHaveBeenCalledWith({
      where: { id: RUN_ID, userId: "user-1", status: "QUEUED" },
      data: {
        status: "FAILED",
        error: "GITHUB_DISPATCH_UNREACHABLE",
        terminalAt: expect.any(Date),
        queries: { title: "SWE", queries: ["SWE"] },
      },
    });
    expect(fetchRunStore.executeRawLock).toHaveBeenCalled();
  });

  it("maps the safe outbound timeout to a stable dispatch timeout", async () => {
    mockAuthedUser();
    mockLockAcquired(true);
    fetchRunStore.findFirstInTx.mockResolvedValueOnce({
      id: RUN_ID,
      status: "QUEUED",
      market: "AU",
      queries: { title: "SWE", queries: ["SWE"] },
    });
    fetchRunStore.updateInTx.mockResolvedValueOnce({});
    fetchRunStore.updateMany.mockResolvedValue({ count: 1 });
    safeFetchHarness.fetch.mockRejectedValueOnce(
      new SafeOutboundError("REQUEST_TIMEOUT", "Outbound request timed out"),
    );

    const res = await POST(
      new Request(`http://localhost/api/fetch-runs/${RUN_ID}/trigger`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: RUN_ID }) },
    );

    expect(res.status).toBe(504);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "GITHUB_DISPATCH_TIMEOUT",
        message: "GitHub dispatch timed out",
      },
    });
    expect(fetchRunStore.expireInTx).toHaveBeenCalledWith({
      where: { id: RUN_ID, userId: "user-1", status: "QUEUED" },
      data: {
        status: "FAILED",
        error: "GITHUB_DISPATCH_TIMEOUT",
        terminalAt: expect.any(Date),
        queries: { title: "SWE", queries: ["SWE"] },
      },
    });
    expect(fetchRunStore.executeRawLock).toHaveBeenCalled();
  });

  it.each([
    ["CN", inlineProcessors.cn, "CN_FETCH_FAILED"],
    ["GLOBAL", inlineProcessors.global, "GLOBAL_FETCH_FAILED"],
  ] as const)(
    "returns a stable non-2xx error when %s inline processing fails",
    async (market, processor, errorCode) => {
      mockAuthedUser();
      mockLockAcquired(true);
      fetchRunStore.findFirstInTx.mockResolvedValueOnce({
        id: RUN_ID,
        status: "QUEUED",
        market,
        queries: { queries: ["SWE"], sources: ["nowcoder"] },
      });
      fetchRunStore.updateInTx.mockResolvedValueOnce({});
      fetchRunStore.updateMany.mockResolvedValue({ count: 1 });
      processor.mockResolvedValueOnce({
        discovered: 0,
        imported: 0,
        error: "upstream detail",
      });

      const res = await POST(
        new Request(`http://localhost/api/fetch-runs/${RUN_ID}/trigger`, { method: "POST" }),
        { params: Promise.resolve({ id: RUN_ID }) },
      );

      expect(res.status).toBe(502);
      await expect(res.json()).resolves.toMatchObject({
        error: { code: errorCode },
      });
    },
  );
});
