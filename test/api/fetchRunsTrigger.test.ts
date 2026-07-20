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
    fetchRunStore.expireInTx.mockReset().mockResolvedValue({ count: 0 });
    fetchRunStore.updateMany.mockReset();
    fetchRunStore.queryRawLock.mockReset();
    fetchRunStore.executeRawLock.mockReset();
    fetchRunStore.executeRawLock.mockResolvedValue(1);
    fetchRunStore.countInTx.mockReset();
    fetchRunStore.countInTx.mockResolvedValue(0);
    inlineProcessors.cn.mockReset();
    inlineProcessors.global.mockReset();
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
    expect(fetchRunStore.updateInTx).toHaveBeenCalled();
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

  it("returns 429 without claiming or dispatching when persistent active quota is exceeded", async () => {
    mockAuthedUser();
    mockLockAcquired(true);
    fetchRunStore.findFirstInTx.mockResolvedValueOnce({
      id: RUN_ID,
      status: "QUEUED",
      market: "AU",
      queries: { title: "SWE", queries: ["SWE"] },
    });
    fetchRunStore.countInTx.mockResolvedValueOnce(3);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(
      new Request(`http://localhost/api/fetch-runs/${RUN_ID}/trigger`, { method: "POST" }),
      { params: Promise.resolve({ id: RUN_ID }) },
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "FETCH_RUN_QUOTA_EXCEEDED",
        message: "Free fetch capacity is busy right now. Try again shortly.",
        reason: "USER_ACTIVE_LIMIT",
        limit: 2,
      },
    });
    expect(fetchRunStore.updateInTx).not.toHaveBeenCalled();
    expect(fetchRunStore.updateMany).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(fetchRunStore.updateMany).toHaveBeenCalledTimes(1);
    expect(fetchRunStore.updateMany).toHaveBeenCalledWith({
      where: { id: RUN_ID, userId: "user-1", status: "QUEUED" },
      data: {
        status: "FAILED",
        error: "GITHUB_DISPATCH_FAILED",
        queries: { title: "SWE", queries: ["SWE"] },
      },
    });
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
      error: "GITHUB_DISPATCH_NOT_CONFIGURED",
    });
    expect(fetchRunStore.updateMany).toHaveBeenCalledWith({
      where: { id: RUN_ID, userId: "user-1", status: "QUEUED" },
      data: {
        status: "FAILED",
        error: "GITHUB_DISPATCH_NOT_CONFIGURED",
        queries: { title: "SWE", queries: ["SWE"] },
      },
    });
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
      error: "GITHUB_DISPATCH_UNREACHABLE",
    });
    expect(fetchRunStore.updateMany).toHaveBeenCalledWith({
      where: { id: RUN_ID, userId: "user-1", status: "QUEUED" },
      data: {
        status: "FAILED",
        error: "GITHUB_DISPATCH_UNREACHABLE",
        queries: { title: "SWE", queries: ["SWE"] },
      },
    });
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
      error: "GITHUB_DISPATCH_TIMEOUT",
    });
    expect(fetchRunStore.updateMany).toHaveBeenCalledWith({
      where: { id: RUN_ID, userId: "user-1", status: "QUEUED" },
      data: {
        status: "FAILED",
        error: "GITHUB_DISPATCH_TIMEOUT",
        queries: { title: "SWE", queries: ["SWE"] },
      },
    });
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
      await expect(res.json()).resolves.toEqual({ error: errorCode });
    },
  );
});
