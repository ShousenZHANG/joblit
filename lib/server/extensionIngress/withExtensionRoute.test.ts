import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authErrors = vi.hoisted(() => {
  class MockExtensionTokenError extends Error {}
  class MockUnauthorizedError extends Error {}
  return { MockExtensionTokenError, MockUnauthorizedError };
});

vi.mock("@/lib/server/auth/requireExtensionToken", () => ({
  ExtensionTokenError: authErrors.MockExtensionTokenError,
  requireExtensionToken: vi.fn(),
}));
vi.mock("@/lib/server/auth/requireSession", () => ({
  UnauthorizedError: authErrors.MockUnauthorizedError,
  requireSession: vi.fn(),
}));

import { AppError } from "@/lib/server/api/appError";
import { ExtensionTokenError } from "@/lib/server/auth/requireExtensionToken";
import { UnauthorizedError } from "@/lib/server/auth/requireSession";
import {
  AbuseBudgetUnavailableError,
  type AbuseBudgetDecision,
  type AbuseBudgetPort,
} from "./abuseBudget";
import { createExtensionRouteIngress } from "./withExtensionRoute";

const allowed = (
  remaining = 9,
  resetAt = 61_000,
): AbuseBudgetDecision => ({
  allowed: true,
  remaining,
  resetAt,
  retryAfter: 0,
});

const denied = (
  retryAfter = 60,
  resetAt = 61_000,
): AbuseBudgetDecision => ({
  allowed: false,
  remaining: 0,
  resetAt,
  retryAfter,
});

function request(headers: HeadersInit = {}) {
  return new Request("https://joblit.test/api/ext/applications/prompt", {
    headers: {
      authorization: "Bearer extension-token",
      "x-forwarded-for": "203.0.113.9, 10.0.0.1",
      ...headers,
    },
  });
}

function port(
  consume: AbuseBudgetPort["consume"] = vi.fn(async () => allowed()),
): AbuseBudgetPort {
  return { consume };
}

function setup(
  overrides: Partial<Parameters<typeof createExtensionRouteIngress>[0]> = {},
) {
  const calls: string[] = [];
  const primaryBudget = port(
    vi.fn(async (debits) => {
      calls.push(`budget:${debits[0]?.key}`);
      return allowed();
    }),
  );
  const fallbackBudget = port();
  const reportError = vi.fn();
  const dependencies: Parameters<typeof createExtensionRouteIngress>[0] = {
    createRequestId: () => "request-1",
    requireSession: vi.fn(async () => {
      calls.push("auth:session");
      return { userId: "session-user", requestId: "ignored-session-id" };
    }),
    requireExtensionToken: vi.fn(async () => {
      calls.push("auth:bearer");
      return {
        userId: "user-1",
        tokenId: "token-1",
        requestId: "ignored-token-id",
      };
    }),
    primaryBudget,
    fallbackBudget,
    fingerprintIdentity: (kind, value) => `${kind}-fp(${value})`,
    reportError,
    ...overrides,
  };
  return {
    ingress: createExtensionRouteIngress(dependencies),
    dependencies,
    calls,
    reportError,
  };
}

describe("createExtensionRouteIngress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an exhausted IP budget before any authentication lookup", async () => {
    const primaryBudget = port(vi.fn(async () => denied(17, 18_000)));
    const { ingress, dependencies } = setup({ primaryBudget });
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));

    const response = await ingress(
      request(),
      "applications.prompt",
      handler,
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: { code: "RATE_LIMITED", message: "Too many requests" },
      requestId: "request-1",
    });
    expect(dependencies.requireExtensionToken).not.toHaveBeenCalled();
    expect(dependencies.requireSession).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(response.headers.get("retry-after")).toBe("17");
    expect(response.headers.get("x-ratelimit-limit")).toBe("80");
    expect(response.headers.get("x-request-id")).toBe("request-1");
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
  });

  it("does not consume a user budget when bearer authentication fails", async () => {
    const primaryBudget = port(vi.fn(async () => allowed()));
    const { ingress, dependencies } = setup({
      primaryBudget,
      requireExtensionToken: vi.fn(async () => {
        throw new ExtensionTokenError("Invalid token");
      }),
    });

    const response = await ingress(
      request(),
      "applications.prompt",
      vi.fn(async () => NextResponse.json({ ok: true })),
    );

    expect(response.status).toBe(401);
    expect(primaryBudget.consume).toHaveBeenCalledOnce();
    expect(dependencies.fallbackBudget.consume).not.toHaveBeenCalled();
    expect(response.headers.get("x-request-id")).toBe("request-1");
  });

  it("uses the policy auth mode and a user identity independent of IP or token id", async () => {
    const { ingress, dependencies, calls } = setup();
    const handler = vi.fn(async ({ userId, requestId }) => {
      calls.push("handler");
      return NextResponse.json({ userId, requestId });
    });

    const response = await ingress(
      request(),
      "applications.prompt",
      handler,
    );

    expect(calls).toEqual([
      "budget:ext:applications:prompt:ip:ip-fp(203.0.113.9)",
      "auth:bearer",
      "budget:ext:applications:prompt:user:user-fp(user-1)",
      "handler",
    ]);
    expect(dependencies.requireSession).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith({
      userId: "user-1",
      requestId: "request-1",
    });
    expect(response.headers.get("x-ratelimit-limit")).toBe("20");
    expect(response.headers.get("x-ratelimit-remaining")).toBe("9");
    expect(response.headers.get("x-ratelimit-reset")).toBe("61");
  });

  it("uses session authentication for extension-token management", async () => {
    const { ingress, dependencies } = setup();

    const response = await ingress(
      request(),
      "tokens.create",
      async ({ userId }) => NextResponse.json({ userId }),
    );

    expect(dependencies.requireSession).toHaveBeenCalledOnce();
    expect(dependencies.requireExtensionToken).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      userId: "session-user",
    });
  });

  it("returns typed domain failures through the canonical envelope", async () => {
    const { ingress, reportError } = setup();

    const response = await ingress(
      request(),
      "jobs.match",
      async () => {
        throw new AppError({
          code: "JOB_NOT_FOUND",
          status: 404,
          publicMessage: "Job not found.",
        });
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "JOB_NOT_FOUND", message: "Job not found." },
      requestId: "request-1",
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports unexpected failures once and returns a redacted 500", async () => {
    const { ingress, reportError } = setup();
    const privateError = new Error(
      "provider https://internal.invalid?token=secret failed",
    );

    const response = await ingress(
      request(),
      "jobs.import",
      async () => {
        throw privateError;
      },
    );

    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(privateError, {
      scope: "ext:jobs:import",
      userId: "user-1",
      requestId: "request-1",
    });
    expect(response.status).toBe(500);
    const body = JSON.stringify(await response.json());
    expect(body).toContain("INTERNAL_ERROR");
    expect(body).not.toContain("internal.invalid");
    expect(body).not.toContain("secret");
  });

  it("falls back to the isolate budget when the distributed store is unavailable", async () => {
    const primaryBudget = port(
      vi.fn(async () => {
        throw new AbuseBudgetUnavailableError("redis down");
      }),
    );
    const fallbackBudget = port(vi.fn(async () => allowed(4)));
    const { ingress, reportError } = setup({
      primaryBudget,
      fallbackBudget,
    });

    const response = await ingress(
      request(),
      "profile.read",
      async () => NextResponse.json({ ok: true }),
    );

    expect(response.status).toBe(200);
    expect(primaryBudget.consume).toHaveBeenCalledTimes(2);
    expect(fallbackBudget.consume).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenNthCalledWith(
      1,
      expect.any(AbuseBudgetUnavailableError),
      expect.objectContaining({
        scope: "extension.ingress.abuse-budget",
        requestId: "request-1",
        tags: {
          operation: "profile.read",
          phase: "pre-auth",
        },
      }),
    );
  });

  it("preserves pre-auth rate metadata when the user budget fails", async () => {
    const primaryBudget = port(
      vi
        .fn()
        .mockResolvedValueOnce(allowed(7, 62_000))
        .mockRejectedValueOnce(
          new AbuseBudgetUnavailableError("redis down"),
        ),
    );
    const fallbackBudget = port(
      vi.fn(async () => {
        throw new Error("memory budget failed");
      }),
    );
    const { ingress } = setup({ primaryBudget, fallbackBudget });

    const response = await ingress(
      request(),
      "applications.prompt",
      async () => NextResponse.json({ ok: true }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("x-ratelimit-limit")).toBe("80");
    expect(response.headers.get("x-ratelimit-remaining")).toBe("7");
    expect(response.headers.get("x-ratelimit-reset")).toBe("62");
  });

  it("returns a canonical 401 when session authentication fails", async () => {
    const { ingress } = setup({
      requireSession: vi.fn(async () => {
        throw new UnauthorizedError();
      }),
    });

    const response = await ingress(
      request(),
      "tokens.list",
      async () => NextResponse.json({ ok: true }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
