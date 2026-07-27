import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/client/localAiBridge", async () => {
  const actual = await vi.importActual<typeof import("@/lib/client/localAiBridge")>(
    "@/lib/client/localAiBridge",
  );
  return { ...actual, sendLocalAiBridgeRequest: bridge.send };
});

import { useFitScan } from "./useFitScan";
import { LocalAiBridgeError } from "@/lib/client/localAiBridge";

const JOB_A = "11111111-1111-4111-8111-111111111111";
const JOB_B = "22222222-2222-4222-8222-222222222222";
const CLAIM_TOKEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const promptMeta = { resumeSnapshotUpdatedAt: "2026-07-15T00:00:00.000Z" };

type FetchLog = { url: string; body: unknown };

function mockServer(config: {
  run: { total: number; scored: number; pending: number; prescreened: number };
  batches: string[][];
  scoredPerImport?: string[][];
}) {
  const log: FetchLog[] = [];
  let batchIndex = 0;
  let importIndex = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      log.push({ url, body });
      const json = (data: unknown) =>
        new Response(JSON.stringify(data), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (url.includes("/api/jobs/fit/run")) return json(config.run);
      if (url.includes("/api/jobs/fit/next-batch")) {
        const jobIds = config.batches[batchIndex] ?? [];
        batchIndex += 1;
        const remaining = config.batches
          .slice(batchIndex)
          .reduce((sum, batch) => sum + batch.length, 0);
        return json({
          jobIds,
          remaining,
          claimToken: jobIds.length > 0 ? CLAIM_TOKEN : null,
        });
      }
      if (url.includes("/api/jobs/fit/batch-import")) {
        const scored = (config.scoredPerImport?.[importIndex] ?? body?.jobIds ?? []) as string[];
        importIndex += 1;
        return json({ scored: scored.map((jobId: string) => ({ jobId })) });
      }
      if (url.includes("/api/jobs/fit/mark-failed")) return json({ count: body?.jobIds?.length ?? 0 });
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return log;
}

function succeededRun(jobIds: string[]) {
  return {
    requestId: crypto.randomUUID(),
    jobId: jobIds[0],
    target: "triage" as const,
    status: "succeeded" as const,
    modelOutput: JSON.stringify(jobIds.map((jobId) => ({ jobId, matchScore: 70 }))),
    promptMeta,
  };
}

function runningRun(jobIds: string[]) {
  return {
    requestId: crypto.randomUUID(),
    jobId: jobIds[0],
    target: "triage" as const,
    status: "running" as const,
  };
}

describe("useFitScan (database-backed pump)", () => {
  beforeEach(() => {
    bridge.send.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("prescreens server-side then pumps batches until the database queue is empty", async () => {
    const log = mockServer({
      run: { total: 40, scored: 12, pending: 4, prescreened: 8 },
      batches: [[JOB_A, JOB_B], [JOB_B], []],
    });
    bridge.send.mockImplementation(async (action: string, payload: { jobIds?: string[] }) => {
      if (action === "START_RUN") return succeededRun(payload.jobIds ?? []);
      throw new Error(`unexpected ${action}`);
    });
    const onJobScored = vi.fn();
    const { result } = renderHook(() => useFitScan({ onJobScored }));
    await act(async () => result.current.start());
    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        status: "done",
        total: 40,
        prescreened: 8,
        scored: 3,
        failed: 0,
        remaining: 0,
      }),
    );
    // The pump asked the server for batches instead of using loaded page items.
    expect(log.filter((entry) => entry.url.includes("next-batch"))).toHaveLength(3);
    expect(onJobScored).toHaveBeenCalled();
  });

  it("marks a failed batch server-side so the queue never loops on it", async () => {
    const log = mockServer({
      run: { total: 2, scored: 0, pending: 2, prescreened: 0 },
      batches: [[JOB_A, JOB_B], []],
    });
    bridge.send.mockRejectedValue(new LocalAiBridgeError("HERMES_AUTH_FAILED", "bad key", false));
    const { result } = renderHook(() => useFitScan({ onJobScored: vi.fn() }));
    await act(async () => result.current.start());
    await waitFor(() =>
      expect(result.current.state).toMatchObject({ status: "done", failed: 2, scored: 0 }),
    );
    const markFailed = log.find((entry) => entry.url.includes("mark-failed"));
    expect(markFailed?.body).toEqual({
      jobIds: [JOB_A, JOB_B],
      claimToken: CLAIM_TOKEN,
    });
  });

  it("counts partially imported batches as scored plus failed and dequeues the rest", async () => {
    const log = mockServer({
      run: { total: 2, scored: 0, pending: 2, prescreened: 0 },
      batches: [[JOB_A, JOB_B], []],
      scoredPerImport: [[JOB_A]],
    });
    bridge.send.mockImplementation(async (action: string, payload: { jobIds?: string[] }) => {
      if (action === "START_RUN") return succeededRun(payload.jobIds ?? []);
      throw new Error(`unexpected ${action}`);
    });
    const { result } = renderHook(() => useFitScan({ onJobScored: vi.fn() }));
    await act(async () => result.current.start());
    await waitFor(() =>
      expect(result.current.state).toMatchObject({ status: "done", scored: 1, failed: 1 }),
    );
    expect(log.some((entry) => entry.url.includes("mark-failed"))).toBe(true);
  });

  it("waits for a fresh lease and resumes instead of reporting a false done state", async () => {
    let nextBatchCalls = 0;
    let releaseRecoveredBatch = () => {};
    const recoveredBatchReady = new Promise<void>((resolve) => {
      releaseRecoveredBatch = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const json = (data: unknown) =>
          new Response(JSON.stringify(data), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        if (url.includes("/api/jobs/fit/run")) {
          return json({
            total: 1,
            scored: 0,
            pending: 1,
            prescreened: 0,
          });
        }
        if (url.includes("/api/jobs/fit/next-batch")) {
          nextBatchCalls += 1;
          if (nextBatchCalls === 1) {
            return json({
              jobIds: [],
              remaining: 1,
              pendingTotal: 1,
              leased: 1,
              retryAfterMs: 1,
              claimToken: null,
            });
          }
          if (nextBatchCalls === 2) {
            await recoveredBatchReady;
            return json({
              jobIds: [JOB_A],
              remaining: 0,
              pendingTotal: 1,
              leased: 1,
              retryAfterMs: null,
              claimToken: CLAIM_TOKEN,
            });
          }
          return json({
            jobIds: [],
            remaining: 0,
            pendingTotal: 0,
            leased: 0,
            retryAfterMs: null,
            claimToken: null,
          });
        }
        if (url.includes("/api/jobs/fit/batch-import")) {
          const body = init?.body ? JSON.parse(String(init.body)) : {};
          return json({
            scored: (body.jobIds ?? []).map((jobId: string) => ({ jobId })),
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    bridge.send.mockImplementation(
      async (action: string, payload: { jobIds?: string[] }) => {
        if (action === "START_RUN") return succeededRun(payload.jobIds ?? []);
        throw new Error(`unexpected ${action}`);
      },
    );

    const { result } = renderHook(() =>
      useFitScan({ onJobScored: vi.fn(), leasePollMinMs: 1 }),
    );
    let scanPromise: Promise<void> | undefined;
    act(() => {
      scanPromise = result.current.start();
    });

    await waitFor(() => expect(nextBatchCalls).toBe(2));
    expect(result.current.state).toMatchObject({
      status: "scanning",
      remaining: 1,
      leased: 1,
    });
    expect(bridge.send).not.toHaveBeenCalled();

    await act(async () => {
      releaseRecoveredBatch();
      await scanPromise;
    });

    expect(nextBatchCalls).toBe(3);
    expect(bridge.send).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({
      status: "done",
      scored: 1,
      remaining: 0,
      leased: 0,
    });
  });

  it("starts a fresh run when the service worker forgets the one it is polling", async () => {
    // A service-worker restart drops the run registry, so GET_RUN on the old
    // requestId can never succeed. The extension raises HERMES_RUN_NOT_FOUND
    // internally, but apiErrors.toPublicLocalAiError rewrites it to RUN_LOST
    // before it crosses the bridge — RUN_LOST is what the web side actually
    // sees, and it arrives retryable. Polling cannot recover; only a new
    // requestId can.
    mockServer({
      run: { total: 1, scored: 0, pending: 1, prescreened: 0 },
      batches: [[JOB_A], []],
    });
    let startCalls = 0;
    let getRunCalls = 0;
    bridge.send.mockImplementation(
      async (action: string, payload: { jobIds?: string[] }) => {
        if (action === "START_RUN") {
          startCalls += 1;
          // The first attempt is accepted and then forgotten; the second
          // attempt runs to completion.
          return startCalls === 1
            ? runningRun(payload.jobIds ?? [])
            : succeededRun(payload.jobIds ?? []);
        }
        if (action === "GET_RUN") {
          getRunCalls += 1;
          throw new LocalAiBridgeError("RUN_LOST", "run is gone", true);
        }
        if (action === "STOP_RUN") return undefined;
        throw new Error(`unexpected ${action}`);
      },
    );

    const { result } = renderHook(() =>
      useFitScan({ onJobScored: vi.fn(), retryBackoffMs: 1, pollMs: 1 }),
    );
    await act(async () => result.current.start());

    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        status: "done",
        scored: 1,
        failed: 0,
      }),
    );
    // Restarted once rather than polling a dead run until the 240s budget ran out.
    expect(startCalls).toBe(2);
    expect(getRunCalls).toBe(3);
  });

  it("reports failed when the server run endpoint rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    const { result } = renderHook(() => useFitScan({ onJobScored: vi.fn() }));
    await act(async () => result.current.start());
    await waitFor(() => expect(result.current.state.status).toBe("failed"));
  });

  // The fit endpoints used a private postJson that threw
  // `new Error("/api/jobs/fit/run failed: 429")`, so the whole fit surface was
  // invisible to the ApiError handling every other cluster relies on — and the
  // user was shown a URL and a status code instead of what the server said.
  it("surfaces the server's own message rather than a url and a status code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "FIT_SCAN_BUSY",
                message: "Another scan is already running for this account.",
              },
            }),
            { status: 409, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const { result } = renderHook(() => useFitScan({ onJobScored: vi.fn() }));
    await act(async () => result.current.start());

    await waitFor(() => expect(result.current.state.status).toBe("failed"));
    expect(result.current.state.error).toBe(
      "Another scan is already running for this account.",
    );
    expect(result.current.state.error).not.toContain("/api/jobs/fit/run");
  });
});
