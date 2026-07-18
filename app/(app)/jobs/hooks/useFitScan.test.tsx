import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/client/localAiBridge", async () => {
  const actual = await vi.importActual<typeof import("@/lib/client/localAiBridge")>(
    "@/lib/client/localAiBridge",
  );
  return { ...actual, sendLocalAiBridgeRequest: bridge.send };
});

import { FIT_SCAN_STORAGE_KEY, useFitScan } from "./useFitScan";
import { LocalAiBridgeError } from "@/lib/client/localAiBridge";

const JOB_A = "11111111-1111-4111-8111-111111111111";
const JOB_B = "22222222-2222-4222-8222-222222222222";
const promptMeta = { resumeSnapshotUpdatedAt: "2026-07-15T00:00:00.000Z" };

function mockFetchRoutes(routes: {
  prescreen?: { poor: Array<{ jobId: string }>; needAi: string[] };
  batchScored?: string[];
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/jobs/fit/prescreen")) {
        return new Response(JSON.stringify(routes.prescreen ?? { poor: [], needAi: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/jobs/fit/batch-import")) {
        return new Response(
          JSON.stringify({ scored: (routes.batchScored ?? []).map((jobId) => ({ jobId })) }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}

describe("useFitScan", () => {
  beforeEach(() => {
    sessionStorage.clear();
    bridge.send.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("scores a batch and reports done with counts", async () => {
    mockFetchRoutes({ prescreen: { poor: [], needAi: [JOB_A, JOB_B] }, batchScored: [JOB_A, JOB_B] });
    bridge.send.mockImplementation(async (action: string, payload: { jobIds?: string[] }) => {
      if (action === "START_RUN") {
        expect(payload.jobIds).toEqual([JOB_A, JOB_B]);
        return {
          requestId: crypto.randomUUID(),
          jobId: JOB_A,
          target: "triage",
          status: "succeeded",
          modelOutput: JSON.stringify([
            { jobId: JOB_A, matchScore: 80 },
            { jobId: JOB_B, matchScore: 10 },
          ]),
          promptMeta,
        };
      }
      throw new Error(`unexpected ${action}`);
    });
    const onJobScored = vi.fn();
    const { result } = renderHook(() => useFitScan({ onJobScored }));
    await act(async () => result.current.start([JOB_A, JOB_B]));
    await waitFor(() =>
      expect(result.current.state).toMatchObject({ status: "done", scored: 2, failed: 0 }),
    );
    expect(onJobScored).toHaveBeenCalled();
    expect(sessionStorage.getItem(FIT_SCAN_STORAGE_KEY)).toBeNull();
  });

  it("retries the same request id after a retryable rate-limit instead of failing the batch", async () => {
    mockFetchRoutes({ prescreen: { poor: [], needAi: [JOB_A] }, batchScored: [JOB_A] });
    const startPayloads: Array<{ requestId: string }> = [];
    let calls = 0;
    bridge.send.mockImplementation(async (action: string, payload: { requestId: string }) => {
      if (action === "START_RUN") {
        startPayloads.push(payload);
        calls += 1;
        if (calls === 1) {
          throw new LocalAiBridgeError("RATE_LIMITED", "slow down", true);
        }
        return {
          requestId: payload.requestId,
          jobId: JOB_A,
          target: "triage",
          status: "succeeded",
          modelOutput: JSON.stringify([{ jobId: JOB_A, matchScore: 55 }]),
          promptMeta,
        };
      }
      throw new Error(`unexpected ${action}`);
    });
    const { result } = renderHook(() =>
      useFitScan({ onJobScored: vi.fn(), retryBackoffMs: 50 }),
    );
    await act(async () => result.current.start([JOB_A]));
    await waitFor(
      () => expect(result.current.state).toMatchObject({ status: "done", scored: 1, failed: 0 }),
      { timeout: 10_000 },
    );
    // Retried with the SAME requestId — the worker-side start is idempotent.
    expect(startPayloads.length).toBeGreaterThanOrEqual(2);
    expect(new Set(startPayloads.map((p) => p.requestId)).size).toBe(1);
  });

  it("marks the batch failed on a non-retryable error", async () => {
    mockFetchRoutes({ prescreen: { poor: [], needAi: [JOB_A] } });
    bridge.send.mockRejectedValue(
      new LocalAiBridgeError("HERMES_AUTH_FAILED", "bad key", false),
    );
    const { result } = renderHook(() => useFitScan({ onJobScored: vi.fn() }));
    await act(async () => result.current.start([JOB_A]));
    await waitFor(() =>
      expect(result.current.state).toMatchObject({ status: "done", scored: 0, failed: 1 }),
    );
  });
});
