import { afterEach, describe, expect, it, vi } from "vitest";

import { AbuseBudgetUnavailableError } from "./abuseBudget";
import { createUpstashAbuseBudgetPort } from "./abuseBudgetUpstash";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createUpstashAbuseBudgetPort", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends every debit through one atomic EVAL request", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ result: [1, 3, 61_000, 0] }),
    );
    const port = createUpstashAbuseBudgetPort({
      url: "https://redis.example/",
      token: "secret",
      keyPrefix: "joblit:test:",
      fetchImpl,
    });

    await expect(
      port.consume([
        {
          key: "ip:fingerprint",
          limit: 10,
          windowMs: 60_000,
          cost: 2,
        },
        {
          key: "user:id",
          limit: 5,
          windowMs: 30_000,
        },
      ]),
    ).resolves.toEqual({
      allowed: true,
      remaining: 3,
      resetAt: 61_000,
      retryAfter: 0,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://redis.example");
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer secret",
    );

    const command = JSON.parse(String(init.body)) as unknown[];
    expect(command[0]).toBe("EVAL");
    expect(String(command[1])).toContain('redis.call("TIME")');
    expect(command.slice(2)).toEqual([
      "2",
      "joblit:test:ip:fingerprint",
      "joblit:test:user:id",
      "10",
      "60000",
      "2",
      "5",
      "30000",
      "1",
    ]);
  });

  it("accepts numeric strings returned by the REST API", async () => {
    const port = createUpstashAbuseBudgetPort({
      url: "https://redis.example",
      token: "secret",
      fetchImpl: vi.fn(async () =>
        jsonResponse({ result: ["0", "0", "9000", "7"] }),
      ),
    });

    await expect(
      port.consume([
        { key: "user:id", limit: 1, windowMs: 10_000 },
      ]),
    ).resolves.toEqual({
      allowed: false,
      remaining: 0,
      resetAt: 9_000,
      retryAfter: 7,
    });
  });

  it.each([
    {
      name: "network failures",
      fetchImpl: vi.fn(async () => {
        throw new Error("socket closed");
      }),
    },
    {
      name: "non-success responses",
      fetchImpl: vi.fn(async () => jsonResponse({ error: "down" }, 503)),
    },
    {
      name: "REST error envelopes",
      fetchImpl: vi.fn(async () => jsonResponse({ error: "ERR disabled" })),
    },
    {
      name: "mixed error and result envelopes",
      fetchImpl: vi.fn(async () =>
        jsonResponse({
          result: [1, 0, 61_000, 0],
          error: "ERR disabled",
        }),
      ),
    },
    {
      name: "malformed result tuples",
      fetchImpl: vi.fn(async () => jsonResponse({ result: [1, -1] })),
    },
    {
      name: "non-scalar result values",
      fetchImpl: vi.fn(async () =>
        jsonResponse({ result: [1, { value: 0 }, 61_000, 0] }),
      ),
    },
  ])("throws a typed unavailable error for $name", async ({ fetchImpl }) => {
    const port = createUpstashAbuseBudgetPort({
      url: "https://redis.example",
      token: "secret",
      fetchImpl,
    });

    await expect(
      port.consume([
        { key: "user:id", limit: 1, windowMs: 10_000 },
      ]),
    ).rejects.toBeInstanceOf(AbuseBudgetUnavailableError);
  });
});
