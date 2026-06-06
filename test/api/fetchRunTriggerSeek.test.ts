import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaStore = vi.hoisted(() => ({
  $transaction: vi.fn(),
  fetchRun: { updateMany: vi.fn() },
}));

vi.mock("@/lib/server/prisma", () => ({ prisma: prismaStore }));
vi.mock("@/lib/server/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ userId: "u" })),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/server/api/errorResponse", () => ({
  unauthorizedError: () => new Response(null, { status: 401 }),
}));
vi.mock("@/lib/server/observability/errorReporter", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/server/cnFetch/processFetchRun", () => ({ processCnFetchRun: vi.fn() }));

import { POST } from "@/app/api/fetch-runs/[id]/trigger/route";

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const ctx = { params: Promise.resolve({ id: UUID }) };

function dispatchUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0]));
}

beforeEach(() => {
  vi.stubEnv("GITHUB_OWNER", "o");
  vi.stubEnv("GITHUB_REPO", "r");
  vi.stubEnv("GITHUB_TOKEN", "t");
  prismaStore.fetchRun.updateMany.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fetch-run trigger — Seek workflow selection + kill-switch", () => {
  it("dispatches the seek workflow for a seek run", async () => {
    vi.stubEnv("SEEK_FETCH_ENABLED", "true");
    prismaStore.$transaction.mockResolvedValue({ kind: "locked", market: "AU", queries: { source: "seek" } });
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => "" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(new Request("http://localhost", { method: "POST" }), ctx);
    expect(res.status).toBe(200);
    expect(dispatchUrls(fetchMock).some((u) => u.includes("seek-fetch.yml"))).toBe(true);
  });

  it("dispatches the jobspy workflow by default", async () => {
    prismaStore.$transaction.mockResolvedValue({ kind: "locked", market: "AU", queries: { source: "jobspy" } });
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => "" }));
    vi.stubGlobal("fetch", fetchMock);

    await POST(new Request("http://localhost", { method: "POST" }), ctx);
    expect(dispatchUrls(fetchMock).some((u) => u.includes("jobspy-fetch.yml"))).toBe(true);
  });

  it("refuses to dispatch a seek run when the kill-switch is off", async () => {
    vi.stubEnv("SEEK_FETCH_ENABLED", "");
    prismaStore.$transaction.mockResolvedValue({ kind: "locked", market: "AU", queries: { source: "seek" } });
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => "" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(new Request("http://localhost", { method: "POST" }), ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("SEEK_DISABLED");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prismaStore.fetchRun.updateMany).toHaveBeenCalled(); // slot released
  });
});
