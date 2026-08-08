import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  fetchRepos: vi.fn(),
  filterNoise: vi.fn((repos: unknown[]) => repos.slice(0, 1)),
  readCache: vi.fn(),
  writeCache: vi.fn(),
}));

vi.mock("@/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({
  getServerSession: mocks.getServerSession,
}));
vi.mock("@/lib/server/discover/githubTrending", () => ({
  fetchTrendingRepos: mocks.fetchRepos,
  filterTrendingNoise: mocks.filterNoise,
}));
vi.mock("@/lib/server/discover/discoverCache", () => ({
  buildRepoCacheKey: (period: string, clean: boolean) =>
    `repos:${period}:${clean ? "clean" : "raw"}`,
  // isFresh is pure and moved here when the video helpers were deleted; the
  // real implementation keeps the TTL boundary honest in these tests.
  isFresh: (entry: { expiresAt: Date }, nowMs: number) =>
    entry.expiresAt.getTime() > nowMs,
  readDiscoverCache: mocks.readCache,
  writeDiscoverCache: mocks.writeCache,
}));

import { GET } from "@/app/api/discover/trending/route";

const REPOS = [
  { id: 1, fullName: "openai/codex" },
  { id: 2, fullName: "vercel/next.js" },
];

describe("Discover GitHub trending API", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      if (typeof mock === "function" && "mockReset" in mock) {
        (mock as ReturnType<typeof vi.fn>).mockReset();
      }
    }
    mocks.filterNoise.mockImplementation((repos: unknown[]) => repos.slice(0, 1));
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.writeCache.mockResolvedValue(undefined);
  });

  it("serves a fresh persistent cache across serverless cold starts", async () => {
    mocks.readCache.mockResolvedValue({
      key: "repos:weekly:raw",
      payload: {
        repos: REPOS,
        cached: true,
        fetchedAt: "2026-07-20T06:00:00.000Z",
      },
      fetchedAt: new Date("2026-07-20T06:00:00.000Z"),
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });

    const response = await GET(
      new Request("http://localhost/api/discover/trending?period=weekly"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.cached).toBe(true);
    expect(body.repos).toEqual(REPOS);
    expect(mocks.fetchRepos).not.toHaveBeenCalled();
  });

  it("writes both raw and clean DB payloads after one live fetch", async () => {
    mocks.readCache.mockResolvedValue(null);
    mocks.fetchRepos.mockResolvedValue(REPOS);

    const response = await GET(
      new Request("http://localhost/api/discover/trending?period=monthly&clean=1"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.repos).toEqual([REPOS[0]]);
    expect(mocks.fetchRepos).toHaveBeenCalledWith("monthly");
    expect(mocks.writeCache).toHaveBeenCalledWith(
      "repos:monthly:raw",
      expect.objectContaining({ repos: REPOS }),
      expect.any(Number),
    );
    expect(mocks.writeCache).toHaveBeenCalledWith(
      "repos:monthly:clean",
      expect.objectContaining({ repos: [REPOS[0]] }),
      expect.any(Number),
    );
  });

  it("serves expired DB last-known-good when GitHub is unavailable", async () => {
    mocks.readCache.mockResolvedValue({
      key: "repos:weekly:raw",
      payload: {
        repos: REPOS,
        cached: true,
        fetchedAt: "2026-07-19T06:00:00.000Z",
      },
      fetchedAt: new Date("2026-07-19T06:00:00.000Z"),
      expiresAt: new Date("2026-07-20T05:00:00.000Z"),
    });
    mocks.fetchRepos.mockRejectedValue(new Error("GitHub unavailable"));

    const response = await GET(
      new Request("http://localhost/api/discover/trending?period=weekly"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.cached).toBe(true);
    expect(body.stale).toBe(true);
    expect(body.repos).toEqual(REPOS);
  });
});
