import { afterEach, describe, expect, it, vi } from "vitest";
import { triggerFetchRunWithRecovery } from "./triggerFetchRun";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("triggerFetchRunWithRecovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("invokes the browser fetch implementation with the Window receiver", async () => {
    const browserFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError(
          "Failed to execute 'fetch' on 'Window': Illegal invocation",
        );
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    vi.stubGlobal("fetch", browserFetch);

    await expect(
      triggerFetchRunWithRecovery({ id: "browser-run", source: "jobspy" }),
    ).resolves.toBeUndefined();

    expect(browserFetch.mock.contexts[0]).toBe(globalThis);
  });

  it("retries the same inline run once after the execution lease expires", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: {} }, 504))
      .mockResolvedValueOnce(jsonResponse({ run: { status: "RUNNING" } }))
      .mockResolvedValueOnce(jsonResponse({ run: { status: "RUNNING" } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const wait = vi.fn().mockResolvedValue(undefined);

    await triggerFetchRunWithRecovery(
      { id: "run-1", source: "global" },
      {
        fetchImpl,
        wait,
        recoveryObservationMs: 10,
        recoveryPollIntervalMs: 10,
      },
    );

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "/api/fetch-runs/run-1/trigger",
      { method: "POST" },
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "/api/fetch-runs/run-1");
    expect(fetchImpl).toHaveBeenNthCalledWith(3, "/api/fetch-runs/run-1");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      "/api/fetch-runs/run-1/trigger",
      { method: "POST" },
    );
    expect(wait).toHaveBeenCalledWith(10);
  });

  it("never retries AU dispatch or a terminal inline run", async () => {
    const auFetch = vi.fn().mockResolvedValue(jsonResponse({ error: {} }, 504));
    await expect(
      triggerFetchRunWithRecovery(
        { id: "au-run", source: "jobspy" },
        { fetchImpl: auFetch, wait: vi.fn() },
      ),
    ).rejects.toThrow();
    expect(auFetch).toHaveBeenCalledTimes(1);

    const inlineFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: {} }, 502))
      .mockResolvedValueOnce(jsonResponse({ run: { status: "FAILED" } }));
    await expect(
      triggerFetchRunWithRecovery(
        { id: "cn-run", source: "nowcoder" },
        { fetchImpl: inlineFetch, wait: vi.fn() },
      ),
    ).rejects.toThrow();
    expect(inlineFetch).toHaveBeenCalledTimes(2);
  });

  it("accepts terminal success observed after a lost response without retriggering", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: {} }, 504))
      .mockResolvedValueOnce(jsonResponse({ run: { status: "RUNNING" } }))
      .mockResolvedValueOnce(jsonResponse({ run: { status: "SUCCEEDED" } }));
    const wait = vi.fn().mockResolvedValue(undefined);

    await triggerFetchRunWithRecovery(
      { id: "run-1", source: "global" },
      { fetchImpl, wait },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledWith(5_000);
  });

  it("observes an already-dispatched inline run instead of treating the handoff as complete", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, alreadyDispatched: true }),
      )
      .mockResolvedValueOnce(jsonResponse({ run: { status: "RUNNING" } }))
      .mockResolvedValueOnce(jsonResponse({ run: { status: "PARTIAL" } }));
    const wait = vi.fn().mockResolvedValue(undefined);

    await triggerFetchRunWithRecovery(
      { id: "run-handoff", source: "nowcoder" },
      { fetchImpl, wait },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledWith(5_000);
  });

  it.each(["SUCCEEDED", "RUNNING"] as const)(
    "reconciles a failed recovery POST when the run becomes %s",
    async (finalStatus) => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ error: {} }, 504))
        .mockResolvedValueOnce(jsonResponse({ run: { status: "RUNNING" } }))
        .mockResolvedValueOnce(jsonResponse({ run: { status: "RUNNING" } }))
        .mockResolvedValueOnce(jsonResponse({ error: {} }, 409))
        .mockResolvedValueOnce(
          jsonResponse({ run: { status: finalStatus } }),
        );

      await triggerFetchRunWithRecovery(
        { id: "run-race", source: "global" },
        {
          fetchImpl,
          wait: vi.fn().mockResolvedValue(undefined),
          recoveryObservationMs: 10,
          recoveryPollIntervalMs: 10,
        },
      );

      expect(fetchImpl).toHaveBeenCalledTimes(5);
    },
  );

  it("still surfaces a failed recovery POST when final reconciliation is terminal failure", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: {} }, 504))
      .mockResolvedValueOnce(jsonResponse({ run: { status: "RUNNING" } }))
      .mockResolvedValueOnce(jsonResponse({ run: { status: "RUNNING" } }))
      .mockResolvedValueOnce(jsonResponse({ error: {} }, 409))
      .mockResolvedValueOnce(jsonResponse({ run: { status: "FAILED" } }));

    await expect(
      triggerFetchRunWithRecovery(
        { id: "run-failed", source: "global" },
        {
          fetchImpl,
          wait: vi.fn().mockResolvedValue(undefined),
          recoveryObservationMs: 10,
          recoveryPollIntervalMs: 10,
        },
      ),
    ).rejects.toThrow();
  });
});
