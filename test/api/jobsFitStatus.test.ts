import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The fit progress poll.
 *
 * Scoring moved out of the browser and into the Runner, so the Jobs page no
 * longer knows what has been scored — it asks. Two counts, cheap enough to
 * poll every few seconds while a scan is draining.
 */

const service = vi.hoisted(() => ({ getFitRunStats: vi.fn() }));
const auth = vi.hoisted(() => {
  class UnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
      this.name = "UnauthorizedError";
    }
  }
  return {
    requireSession: vi.fn(),
    requireSessionWithEmail: vi.fn(),
    UnauthorizedError,
  };
});

vi.mock("@/lib/server/jobs/fitRunService", () => service);
vi.mock("@/lib/server/auth/requireSession", () => auth);

import { GET } from "@/app/api/jobs/fit/status/route";

const USER_ID = "user-1";

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireSession.mockResolvedValue({ userId: USER_ID, requestId: "req-1" });
});

describe("GET /api/jobs/fit/status", () => {
  it("reports the caller's scan progress", async () => {
    service.getFitRunStats.mockResolvedValue({ total: 40, scored: 25, pending: 15 });

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ total: 40, scored: 25, pending: 15 });
    expect(service.getFitRunStats).toHaveBeenCalledWith(USER_ID);
  });

  it("requires a session", async () => {
    auth.requireSession.mockRejectedValue(new auth.UnauthorizedError());

    const res = await GET();

    expect(res.status).toBe(401);
    expect(service.getFitRunStats).not.toHaveBeenCalled();
  });
});
