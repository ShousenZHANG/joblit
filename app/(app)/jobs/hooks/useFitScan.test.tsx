import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFitScan } from "./useFitScan";

/**
 * Scoring moved out of the browser: the Runner drains the fit queue against
 * the user's local model. This hook no longer runs anything — it enqueues the
 * scan and watches the server's counts until the queue is empty.
 */

type FetchLog = { url: string; body: unknown };

type Stats = { total: number; scored: number; pending: number };

function mockServer(config: {
  run: Stats & { prescreened: number };
  /** One entry per status poll, in order; the last repeats. */
  polls: Stats[];
  runStatus?: number;
  runError?: unknown;
}) {
  const log: FetchLog[] = [];
  let pollIndex = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      log.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), {
          status,
          headers: { "content-type": "application/json" },
        });
      if (url.includes("/api/jobs/fit/run")) {
        if (config.runError) return json(config.runError, config.runStatus ?? 500);
        return json(config.run);
      }
      if (url.includes("/api/jobs/fit/status")) {
        const stats = config.polls[Math.min(pollIndex, config.polls.length - 1)];
        pollIndex += 1;
        return json(stats);
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return log;
}

function renderFitScan(onJobScored = vi.fn()) {
  return renderHook(() => useFitScan({ onJobScored, pollMs: 1 }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useFitScan (Runner-drained queue)", () => {
  it("enqueues the scan, then follows the server's counts to done", async () => {
    const log = mockServer({
      run: { total: 10, scored: 4, pending: 6, prescreened: 4 },
      polls: [
        { total: 10, scored: 7, pending: 3 },
        { total: 10, scored: 10, pending: 0 },
      ],
    });
    const onJobScored = vi.fn();
    const { result } = renderFitScan(onJobScored);

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => expect(result.current.state.status).toBe("done"));

    // The browser never claims a batch, never calls a model, never imports.
    expect(log.some((entry) => entry.url.includes("next-batch"))).toBe(false);
    expect(log.some((entry) => entry.url.includes("batch-import"))).toBe(false);
    expect(log[0].url).toContain("/api/jobs/fit/run");

    expect(result.current.state.total).toBe(10);
    expect(result.current.state.prescreened).toBe(4);
    expect(result.current.state.remaining).toBe(0);
    // Six were pending when the scan started and all six landed.
    expect(result.current.state.scored).toBe(6);
    expect(onJobScored).toHaveBeenCalled();
  });

  it("finishes immediately when prescreening cleared the whole queue", async () => {
    mockServer({
      run: { total: 5, scored: 5, pending: 0, prescreened: 5 },
      polls: [{ total: 5, scored: 5, pending: 0 }],
    });
    const onJobScored = vi.fn();
    const { result } = renderFitScan(onJobScored);

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => expect(result.current.state.status).toBe("done"));
    expect(result.current.state.scored).toBe(0);
    expect(result.current.state.prescreened).toBe(5);
    expect(onJobScored).toHaveBeenCalled();
  });

  it("reports that it is waiting when no Runner is picking the queue up", async () => {
    mockServer({
      run: { total: 10, scored: 0, pending: 10, prescreened: 0 },
      // The count never moves: nothing is draining the queue.
      polls: [
        { total: 10, scored: 0, pending: 10 },
        { total: 10, scored: 0, pending: 10 },
        { total: 10, scored: 0, pending: 10 },
        { total: 10, scored: 0, pending: 10 },
      ],
    });
    const { result } = renderFitScan();

    // A stalled scan never returns from start(); awaiting it would hang.
    act(() => {
      void result.current.start();
    });

    await waitFor(() => expect(result.current.state.waiting).toBe(true));
    // Waiting is not failure — the scan stays live so a Runner can still start.
    expect(result.current.state.status).toBe("scanning");
    expect(result.current.state.remaining).toBe(10);

    act(() => result.current.stop());
    await waitFor(() => expect(result.current.state.status).toBe("idle"));
  });

  it("stops polling when the user stops the scan", async () => {
    mockServer({
      run: { total: 10, scored: 0, pending: 10, prescreened: 0 },
      polls: [{ total: 10, scored: 2, pending: 8 }],
    });
    const { result } = renderFitScan();

    act(() => {
      void result.current.start();
    });
    await waitFor(() => expect(result.current.state.scored).toBeGreaterThan(0));

    act(() => result.current.stop());

    await waitFor(() => expect(result.current.state.status).toBe("idle"));
    const callsAfterStop = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls
      .length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBe(callsAfterStop);
  });

  it("surfaces the server's own message rather than a url and a status code", async () => {
    mockServer({
      run: { total: 0, scored: 0, pending: 0, prescreened: 0 },
      polls: [],
      runStatus: 404,
      runError: { error: { code: "NO_PROFILE", message: "Create your resume first" } },
    });
    const { result } = renderFitScan();

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => expect(result.current.state.status).toBe("failed"));
    expect(result.current.state.error).toBe("Create your resume first");
  });

  it("reset clears a finished scan", async () => {
    mockServer({
      run: { total: 2, scored: 2, pending: 0, prescreened: 2 },
      polls: [{ total: 2, scored: 2, pending: 0 }],
    });
    const { result } = renderFitScan();

    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => expect(result.current.state.status).toBe("done"));

    act(() => result.current.reset());
    expect(result.current.state.status).toBe("idle");
  });
});
