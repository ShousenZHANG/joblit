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
        return json({ jobIds, remaining });
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
    expect(markFailed?.body).toEqual({ jobIds: [JOB_A, JOB_B] });
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

  it("reports failed when the server run endpoint rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    const { result } = renderHook(() => useFitScan({ onJobScored: vi.fn() }));
    await act(async () => result.current.start());
    await waitFor(() => expect(result.current.state.status).toBe("failed"));
  });
});
