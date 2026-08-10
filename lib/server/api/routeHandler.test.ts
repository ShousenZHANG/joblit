import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const requireSession = vi.fn();
const requireSessionWithEmail = vi.fn();
const reportError = vi.fn();

class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

vi.mock("@/lib/server/auth/requireSession", () => ({
  requireSession: () => requireSession(),
  requireSessionWithEmail: () => requireSessionWithEmail(),
  UnauthorizedError,
}));

vi.mock("@/lib/server/observability/errorReporter", () => ({
  reportError: (...args: unknown[]) => reportError(...args),
}));

const { withSessionRoute, withEmailSessionRoute } = await import(
  "@/lib/server/api/routeHandler"
);

const SESSION = { userId: "user-1", requestId: "req-1" };

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(SESSION);
  requireSessionWithEmail.mockResolvedValue({ ...SESSION, userEmail: "a@b.c" });
});

describe("withSessionRoute", () => {
  it("passes the session context to the handler", async () => {
    const res = await withSessionRoute(async ({ userId, requestId }) =>
      NextResponse.json({ userId, requestId }),
    );
    expect(await res.json()).toEqual({ userId: "user-1", requestId: "req-1" });
  });

  it("returns the canonical 401 envelope when there is no session", async () => {
    requireSession.mockRejectedValue(new UnauthorizedError());
    const handler = vi.fn();
    const res = await withSessionRoute(handler);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers an unexpected handler error with a coded envelope", async () => {
    // This used to assert the rethrow. Rethrowing left Next to answer 500 with
    // no body — no code, no requestId — which an agent client cannot tell from
    // a dropped connection, so it replayed the request and stalled its queue.
    const boom = new Error("boom");
    const res = await withSessionRoute(async () => {
      throw boom;
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error.code).toBe("UNEXPECTED_ERROR");
    expect(json.requestId).toBe("req-1");
    expect(reportError).toHaveBeenCalledWith(boom, {
      scope: "route.session",
      requestId: "req-1",
    });
  });

  it("reports an unexpected error from session resolution before rethrowing", async () => {
    const boom = new Error("session store down");
    requireSession.mockRejectedValue(boom);

    await expect(withSessionRoute(async () => NextResponse.json({}))).rejects.toThrow(boom);
    expect(reportError).toHaveBeenCalledWith(boom, { scope: "route.session" });
  });

  it("renders an AppError thrown by the handler as the canonical envelope", async () => {
    const { AppError } = await import("@/lib/server/api/appError");
    const res = await withSessionRoute(async () => {
      throw new AppError({
        code: "NO_PROFILE",
        status: 404,
        publicMessage: "No Master Resume Profile for this locale.",
      });
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NO_PROFILE", message: "No Master Resume Profile for this locale." },
      requestId: "req-1",
    });
    // A typed domain failure is not a bug, so it is not reported.
    expect(reportError).not.toHaveBeenCalled();
  });

  it("does not report an UnauthorizedError as an unexpected failure", async () => {
    requireSession.mockRejectedValue(new UnauthorizedError());
    await withSessionRoute(async () => NextResponse.json({}));
    expect(reportError).not.toHaveBeenCalled();
  });

  describe("with route params", () => {
    const schema = z.object({ id: z.string().uuid() });
    const id = "11111111-1111-4111-8111-111111111111";

    it("passes parsed params to the handler", async () => {
      const res = await withSessionRoute(
        async ({ userId, params }) => NextResponse.json({ userId, id: params.id }),
        { params: Promise.resolve({ id }), schema },
      );
      expect(await res.json()).toEqual({ userId: "user-1", id });
    });

    it("rejects params that fail the schema without running the handler", async () => {
      const handler = vi.fn();
      const res = await withSessionRoute(handler, {
        params: Promise.resolve({ id: "not-a-uuid" }),
        schema,
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: { code: "INVALID_PARAMS", message: "Invalid route parameters" },
        requestId: "req-1",
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it("checks the session before the params", async () => {
      requireSession.mockRejectedValue(new UnauthorizedError());
      const res = await withSessionRoute(async () => NextResponse.json({}), {
        params: Promise.resolve({ id: "not-a-uuid" }),
        schema,
      });

      // An unauthenticated caller learns nothing about param validity.
      expect(res.status).toBe(401);
    });
  });
});

describe("withEmailSessionRoute", () => {
  it("passes the email-bearing context to the handler", async () => {
    const res = await withEmailSessionRoute(async ({ userEmail }) =>
      NextResponse.json({ userEmail }),
    );
    expect(await res.json()).toEqual({ userEmail: "a@b.c" });
  });

  it("returns 401 when the session carries no email", async () => {
    requireSessionWithEmail.mockRejectedValue(new UnauthorizedError());
    const res = await withEmailSessionRoute(async () => NextResponse.json({}));
    expect(res.status).toBe(401);
    expect(reportError).not.toHaveBeenCalled();
  });
});
