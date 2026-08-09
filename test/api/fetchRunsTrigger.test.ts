import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findFirstInTx: vi.fn(),
  updateMany: vi.fn(),
  updateManyInTx: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
}));
const outbound = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock("@/lib/server/net/safeFetch", () => {
  class SafeOutboundError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "SafeOutboundError";
    }
  }
  return { SafeOutboundError, safeOutboundFetch: outbound.fetch };
});
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    fetchRun: { findFirst: store.findFirst, updateMany: store.updateMany },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        fetchRun: {
          findFirst: store.findFirstInTx,
          updateMany: store.updateManyInTx,
        },
        $queryRaw: store.queryRaw,
        $executeRaw: store.executeRaw,
      }),
  },
}));
vi.mock("@/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/fetch-runs/[id]/trigger/route";

const RUN_ID = "550e8400-e29b-41d4-a716-446655440000";

function post() {
  return POST(
    new Request(`http://localhost/api/fetch-runs/${RUN_ID}/trigger`, {
      method: "POST",
    }),
    { params: Promise.resolve({ id: RUN_ID }) },
  );
}

describe("fetch run trigger api", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    store.findFirst.mockReset().mockResolvedValue({ id: RUN_ID, market: "AU" });
    store.findFirstInTx.mockReset().mockResolvedValue({
      id: RUN_ID,
      status: "QUEUED",
      market: "AU",
      queries: { title: "Software Engineer", queries: ["Software Engineer"] },
    });
    store.updateMany.mockReset().mockResolvedValue({ count: 1 });
    store.updateManyInTx.mockReset().mockResolvedValue({ count: 1 });
    store.queryRaw.mockReset().mockResolvedValue([{ locked: true }]);
    store.executeRaw.mockReset().mockResolvedValue(1);
    outbound.fetch.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
    process.env.GITHUB_OWNER = "owner";
    process.env.GITHUB_REPO = "repo";
    process.env.GITHUB_TOKEN = "token";
    process.env.GITHUB_WORKFLOW_FILE = "jobspy-fetch.yml";
    process.env.GITHUB_REF = "master";
  });

  it("claims and dispatches the AU GitHub workflow once", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(store.queryRaw).toHaveBeenCalled();
    expect(outbound.fetch).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/api\.github\.com\/repos\/owner\/repo\/actions\/workflows\/jobspy-fetch\.yml\/dispatches$/,
      ),
      expect.objectContaining({ method: "POST" }),
      expect.objectContaining({ allowedHosts: ["api.github.com"] }),
    );
    expect(store.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          queries: expect.objectContaining({
            dispatchMeta: expect.objectContaining({
              dispatchedAt: expect.any(String),
            }),
          }),
        }),
      }),
    );
  });

  it("returns alreadyDispatched when the advisory lock is contended", async () => {
    store.queryRaw.mockResolvedValue([{ locked: false }]);
    const response = await post();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      alreadyDispatched: true,
    });
    expect(outbound.fetch).not.toHaveBeenCalled();
  });

  it.each(["CN", "GLOBAL"])(
    "returns 410 without claiming a retired %s run",
    async (market) => {
      store.findFirst.mockResolvedValue({ id: RUN_ID, market });
      const response = await post();
      expect(response.status).toBe(410);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "FETCH_MARKET_RETIRED" },
      });
      expect(store.queryRaw).not.toHaveBeenCalled();
      expect(outbound.fetch).not.toHaveBeenCalled();
    },
  );

  it("returns 404 before claiming a run owned by someone else", async () => {
    store.findFirst.mockResolvedValue(null);
    expect((await post()).status).toBe(404);
    expect(store.queryRaw).not.toHaveBeenCalled();
  });

  it("rejects a non-queued AU run", async () => {
    store.findFirstInTx.mockResolvedValue({
      id: RUN_ID,
      status: "RUNNING",
      market: "AU",
      queries: {},
    });
    const response = await post();
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_STATE" },
    });
    expect(outbound.fetch).not.toHaveBeenCalled();
  });

  it("fails the AU run when GitHub rejects dispatch", async () => {
    outbound.fetch.mockResolvedValue(new Response("boom", { status: 500 }));
    const response = await post();
    expect(response.status).toBe(502);
    expect(store.updateManyInTx).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          error: "GITHUB_DISPATCH_FAILED",
        }),
      }),
    );
  });
});
