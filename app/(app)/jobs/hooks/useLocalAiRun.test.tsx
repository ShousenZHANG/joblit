import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ detect: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/client/localAiBridge", async () => {
  const actual = await vi.importActual<typeof import("@/lib/client/localAiBridge")>(
    "@/lib/client/localAiBridge",
  );
  return {
    ...actual,
    detectLocalAiAvailability: bridge.detect,
    sendLocalAiBridgeRequest: bridge.send,
  };
});

import {
  LOCAL_AI_ACTIVE_REQUEST_KEY,
  LOCAL_AI_POLL_MS,
  useLocalAiRun,
} from "./useLocalAiRun";
import { LocalAiBridgeError } from "@/lib/client/localAiBridge";
import { DraftImportError } from "./useExternalGenerate";

const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440000";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const tailoringRun = {
  id: "8f8f8f8f-8f8f-4f8f-8f8f-8f8f8f8f8f8f",
  attemptId: "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a",
};
const promptMeta = {
  ruleSetId: "rules-1",
  resumeSnapshotUpdatedAt: "2026-07-15T00:00:00.000Z",
  promptTemplateVersion: "v1",
  schemaVersion: "v1",
  skillPackVersion: "pack-1",
  promptHash: "hash-1",
};

describe("useLocalAiRun", () => {
  beforeEach(() => {
    sessionStorage.clear();
    bridge.detect.mockReset();
    bridge.detect.mockResolvedValue("ready");
    bridge.send.mockReset();
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      REQUEST_ID as `${string}-${string}-${string}-${string}-${string}`,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("detects a missing extension with a bounded status request", async () => {
    bridge.detect.mockResolvedValueOnce("extension_missing");
    const { result } = renderHook(() =>
      useLocalAiRun({ enabled: true, onSucceeded: vi.fn() }),
    );
    await waitFor(() => expect(result.current.availability).toBe("extension_missing"));
  });

  it("keeps bridge failures distinct from a missing extension", async () => {
    bridge.detect.mockResolvedValueOnce("bridge_error");
    const { result } = renderHook(() =>
      useLocalAiRun({ enabled: true, onSucceeded: vi.fn() }),
    );
    await waitFor(() => expect(result.current.availability).toBe("bridge_error"));
  });

  it.each(["not_configured", "joblit_disconnected", "unreachable", "auth_failed", "incompatible"] as const)(
    "surfaces setup status %s without connection details",
    async (status) => {
      bridge.detect.mockResolvedValueOnce(status);
      const { result } = renderHook(() =>
        useLocalAiRun({ enabled: true, onSucceeded: vi.fn() }),
      );
      await waitFor(() => expect(result.current.availability).toBe(status));
    },
  );

  it("starts, polls every 750ms without overlap, and consumes success once", async () => {
    const imported = vi.fn().mockResolvedValue(undefined);
    let getRunCalls = 0;
    bridge.send.mockImplementation(async (action: string) => {
      if (action === "GET_STATUS") return { state: "ready", joblitConnected: true };
      if (action === "START_RUN") {
        return {
          requestId: REQUEST_ID,
          jobId: JOB_ID,
          target: "resume",
          status: "queued",
          tailoringRun,
        };
      }
      if (action === "GET_RUN") {
        getRunCalls += 1;
        if (getRunCalls === 1) {
          return {
            requestId: REQUEST_ID,
            jobId: JOB_ID,
            target: "resume",
            status: "running",
            tailoringRun,
          };
        }
        return {
          requestId: REQUEST_ID,
          jobId: JOB_ID,
          target: "resume",
          status: "succeeded",
          modelOutput: "{\"validOutput\":true}",
          promptMeta,
          tailoringRun,
        };
      }
      throw new Error(`unexpected ${action}`);
    });
    const { result } = renderHook(() =>
      useLocalAiRun({ enabled: true, onSucceeded: imported }),
    );
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    await act(async () => result.current.start(JOB_ID, "resume"));
    await waitFor(
      () => expect(result.current.runState.status).toBe("succeeded"),
      { timeout: LOCAL_AI_POLL_MS * 4 },
    );
    expect(imported).toHaveBeenCalledTimes(1);
    expect(imported).toHaveBeenCalledWith(expect.objectContaining({
      status: "succeeded",
      tailoringRun,
    }));
    expect(result.current.runState).toMatchObject({
      status: "succeeded",
      tailoringRun,
    });
    expect(sessionStorage.getItem(LOCAL_AI_ACTIVE_REQUEST_KEY)).toBeNull();
  });

  it("replays the same terminal request after an import response is lost", async () => {
    const imported = vi
      .fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(undefined);
    bridge.send.mockImplementation(async (action: string) => {
      if (action === "GET_STATUS") {
        return { state: "ready", joblitConnected: true };
      }
      if (action === "START_RUN") {
        return {
          requestId: REQUEST_ID,
          jobId: JOB_ID,
          target: "resume",
          status: "queued",
          tailoringRun,
        };
      }
      if (action === "GET_RUN") {
        return {
          requestId: REQUEST_ID,
          jobId: JOB_ID,
          target: "resume",
          status: "succeeded",
          modelOutput: "{\"validOutput\":true}",
          promptMeta,
          tailoringRun,
        };
      }
      throw new Error(`unexpected ${action}`);
    });
    const { result } = renderHook(() =>
      useLocalAiRun({ enabled: true, onSucceeded: imported }),
    );

    await waitFor(() => expect(result.current.availability).toBe("ready"));
    await act(async () => result.current.start(JOB_ID, "resume"));
    await waitFor(() =>
      expect(result.current.runState).toMatchObject({
        status: "failed",
        requestId: REQUEST_ID,
        error: { code: "IMPORT_FAILED", retryable: true },
      }),
    );
    expect(sessionStorage.getItem(LOCAL_AI_ACTIVE_REQUEST_KEY)).toBe(REQUEST_ID);

    await act(async () => result.current.retry());
    await waitFor(() => expect(result.current.runState.status).toBe("succeeded"));

    expect(imported).toHaveBeenCalledTimes(2);
    expect(
      bridge.send.mock.calls.filter(([action]) => action === "START_RUN"),
    ).toHaveLength(1);
    expect(sessionStorage.getItem(LOCAL_AI_ACTIVE_REQUEST_KEY)).toBeNull();
  });

  it("repairs a rejected import once and consumes the corrected result", async () => {
    const imported = vi
      .fn()
      .mockRejectedValueOnce(
        new DraftImportError("Invalid", "INVALID_AI_RESULT", ["cvSummary exceeds 2000 chars"]),
      )
      .mockResolvedValue(undefined);
    let repaired = false;
    bridge.send.mockImplementation(async (action: string, payload: unknown) => {
      if (action === "GET_STATUS") return { state: "ready", joblitConnected: true };
      if (action === "START_RUN") {
        return { requestId: REQUEST_ID, jobId: JOB_ID, target: "resume", status: "queued" };
      }
      if (action === "REPAIR_RUN") {
        expect(payload).toMatchObject({
          requestId: REQUEST_ID,
          feedback: expect.stringContaining("cvSummary exceeds"),
        });
        repaired = true;
        return { requestId: REQUEST_ID, jobId: JOB_ID, target: "resume", status: "running" };
      }
      if (action === "GET_RUN") {
        return {
          requestId: REQUEST_ID,
          jobId: JOB_ID,
          target: "resume",
          status: "succeeded",
          modelOutput: repaired
            ? "{\"validOutput\":true,\"repaired\":true}"
            : "{\"validOutput\":false,\"tooLong\":1}",
          promptMeta,
        };
      }
      throw new Error(`unexpected ${action}`);
    });
    const { result } = renderHook(() =>
      useLocalAiRun({ enabled: true, onSucceeded: imported }),
    );
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    await act(async () => result.current.start(JOB_ID, "resume"));
    await waitFor(
      () => expect(result.current.runState.status).toBe("succeeded"),
      { timeout: LOCAL_AI_POLL_MS * 8 },
    );
    expect(imported).toHaveBeenCalledTimes(2);
    expect(imported.mock.calls[1][0]).toMatchObject({
      modelOutput: "{\"validOutput\":true,\"repaired\":true}",
    });
    expect(
      bridge.send.mock.calls.filter(([action]) => action === "REPAIR_RUN"),
    ).toHaveLength(1);
  });

  it("does not repair twice when the corrected result is still rejected", async () => {
    const imported = vi
      .fn()
      .mockRejectedValue(
        new DraftImportError("Invalid", "INVALID_AI_RESULT", ["still invalid"]),
      );
    bridge.send.mockImplementation(async (action: string) => {
      if (action === "GET_STATUS") return { state: "ready", joblitConnected: true };
      if (action === "START_RUN" || action === "GET_RUN") {
        return {
          requestId: REQUEST_ID,
          jobId: JOB_ID,
          target: "resume",
          status: "succeeded",
          modelOutput: "{\"validOutput\":false}",
          promptMeta,
        };
      }
      if (action === "REPAIR_RUN") {
        return { requestId: REQUEST_ID, jobId: JOB_ID, target: "resume", status: "running" };
      }
      throw new Error(`unexpected ${action}`);
    });
    const { result } = renderHook(() =>
      useLocalAiRun({ enabled: true, onSucceeded: imported }),
    );
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    await act(async () => result.current.start(JOB_ID, "resume"));
    await waitFor(
      () => expect(result.current.runState).toMatchObject({
        status: "failed",
        error: { code: "INVALID_AI_RESULT" },
      }),
      { timeout: LOCAL_AI_POLL_MS * 8 },
    );
    expect(
      bridge.send.mock.calls.filter(([action]) => action === "REPAIR_RUN"),
    ).toHaveLength(1);
    expect(imported).toHaveBeenCalledTimes(2);
  });

  it("exposes best-effort progress while the run is generating", async () => {
    bridge.send.mockImplementation(async (action: string) => {
      if (action === "GET_STATUS") return { state: "ready", joblitConnected: true };
      if (action === "START_RUN") {
        return { requestId: REQUEST_ID, jobId: JOB_ID, target: "resume", status: "queued" };
      }
      if (action === "GET_RUN") {
        return { requestId: REQUEST_ID, jobId: JOB_ID, target: "resume", status: "running", progressChars: 512 };
      }
      throw new Error(`unexpected ${action}`);
    });
    const { result } = renderHook(() =>
      useLocalAiRun({ enabled: true, onSucceeded: vi.fn() }),
    );
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    await act(async () => result.current.start(JOB_ID, "resume"));
    await waitFor(() =>
      expect(result.current.runState).toMatchObject({ status: "running", progressChars: 512 }),
    );
  });

  it("fails a run that never reaches a terminal state with AI_TIMEOUT", async () => {
    bridge.send.mockImplementation(async (action: string) => {
      if (action === "GET_STATUS") return { state: "ready", joblitConnected: true };
      // Hermes keeps reporting the run as running and never completes.
      return { requestId: REQUEST_ID, jobId: JOB_ID, target: "resume", status: "running" };
    });
    const { result } = renderHook(() =>
      useLocalAiRun({ enabled: true, onSucceeded: vi.fn(), maxRunMs: 0 }),
    );
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    await act(async () => result.current.start(JOB_ID, "resume"));
    await waitFor(
      () => expect(result.current.runState).toMatchObject({
        status: "failed",
        error: { code: "AI_TIMEOUT", retryable: true },
      }),
      { timeout: LOCAL_AI_POLL_MS * 4 },
    );
  });

  it("stops an active run and exposes cancellation", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ run: { status: "CANCELLED" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    bridge.send.mockImplementation(async (action: string) => {
      if (action === "GET_STATUS") return { state: "ready", joblitConnected: true };
      if (action === "START_RUN" || action === "GET_RUN") {
        return {
          requestId: REQUEST_ID,
          jobId: JOB_ID,
          target: "cover",
          status: "queued",
          tailoringRun,
        };
      }
      if (action === "STOP_RUN") {
        return {
          requestId: REQUEST_ID,
          jobId: JOB_ID,
          target: "cover",
          status: "cancelled",
          tailoringRun,
        };
      }
      throw new Error(`unexpected ${action}`);
    });
    const { result } = renderHook(() => useLocalAiRun({ enabled: true, onSucceeded: vi.fn() }));
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    await act(async () => result.current.start(JOB_ID, "cover"));
    await act(async () => result.current.stop());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/tailoring-runs/${tailoringRun.id}/cancel`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ attemptId: tailoringRun.attemptId }),
      }),
    );
    const stopCall = bridge.send.mock.calls.find(([action]) => action === "STOP_RUN");
    expect(stopCall?.[1]).toEqual({ requestId: REQUEST_ID });
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(
      bridge.send.mock.invocationCallOrder[
        bridge.send.mock.calls.findIndex(([action]) => action === "STOP_RUN")
      ],
    );
    expect(result.current.runState).toMatchObject({
      status: "cancelled",
      tailoringRun,
    });
  });

  it.each(["queued", "running"] as const)(
    "cancels the durable %s run before stopping Hermes when switching to manual",
    async (status) => {
      const fetchMock = vi.fn(async () =>
        new Response(
          JSON.stringify({
            disposition: "REPLAYED",
            run: { status: "CANCELLED" },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);
      bridge.send.mockImplementation(async (action: string) => {
        if (action === "START_RUN" || action === "GET_RUN") {
          return {
            requestId: REQUEST_ID,
            jobId: JOB_ID,
            target: "resume",
            status,
            tailoringRun,
          };
        }
        if (action === "STOP_RUN") {
          return {
            requestId: REQUEST_ID,
            jobId: JOB_ID,
            target: "resume",
            status: "cancelled",
            tailoringRun,
          };
        }
        throw new Error(`unexpected ${action}`);
      });
      const { result } = renderHook(() =>
        useLocalAiRun({ enabled: true, onSucceeded: vi.fn() }),
      );
      await waitFor(() => expect(result.current.availability).toBe("ready"));
      await act(async () => result.current.start(JOB_ID, "resume"));
      await waitFor(() => expect(result.current.runState.status).toBe(status));

      let switched = false;
      await act(async () => {
        switched = await result.current.switchToManual();
      });

      expect(switched).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/tailoring-runs/${tailoringRun.id}/cancel`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ attemptId: tailoringRun.attemptId }),
        }),
      );
      const stopCallIndex = bridge.send.mock.calls.findIndex(
        ([action]) => action === "STOP_RUN",
      );
      expect(stopCallIndex).toBeGreaterThanOrEqual(0);
      expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(
        bridge.send.mock.invocationCallOrder[stopCallIndex],
      );
      expect(result.current.runState).toEqual({ status: "idle" });
      expect(sessionStorage.getItem(LOCAL_AI_ACTIVE_REQUEST_KEY)).toBeNull();
    },
  );

  it("keeps manual closed and preserves recovery when durable cancellation fails", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: { code: "ATTEMPT_FENCED", message: "Attempt is stale" },
        }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    bridge.send.mockImplementation(async (action: string) => {
      if (action === "START_RUN" || action === "GET_RUN") {
        return {
          requestId: REQUEST_ID,
          jobId: JOB_ID,
          target: "resume",
          status: "queued",
          tailoringRun,
        };
      }
      throw new Error(`unexpected ${action}`);
    });
    const { result } = renderHook(() =>
      useLocalAiRun({ enabled: true, onSucceeded: vi.fn() }),
    );
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    await act(async () => result.current.start(JOB_ID, "resume"));

    let switched = true;
    await act(async () => {
      switched = await result.current.switchToManual();
    });

    expect(switched).toBe(false);
    expect(result.current.runState).toMatchObject({
      status: "failed",
      tailoringRun,
      error: { code: "RUN_CANCEL_FAILED", retryable: true },
    });
    expect(
      bridge.send.mock.calls.filter(([action]) => action === "STOP_RUN"),
    ).toHaveLength(0);
    expect(sessionStorage.getItem(LOCAL_AI_ACTIVE_REQUEST_KEY)).toBe(REQUEST_ID);
  });

  it("keeps manual closed and preserves recovery when Hermes stop fails", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          disposition: "REPLAYED",
          run: { status: "CANCELLED" },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    bridge.send.mockImplementation(async (action: string) => {
      if (action === "START_RUN" || action === "GET_RUN") {
        return {
          requestId: REQUEST_ID,
          jobId: JOB_ID,
          target: "resume",
          status: "running",
          tailoringRun,
        };
      }
      if (action === "STOP_RUN") throw new Error("Hermes stop failed");
      throw new Error(`unexpected ${action}`);
    });
    const { result } = renderHook(() =>
      useLocalAiRun({ enabled: true, onSucceeded: vi.fn() }),
    );
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    await act(async () => result.current.start(JOB_ID, "resume"));

    let switched = true;
    await act(async () => {
      switched = await result.current.switchToManual();
    });

    expect(switched).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      bridge.send.mock.calls.filter(([action]) => action === "STOP_RUN"),
    ).toHaveLength(1);
    expect(result.current.runState).toMatchObject({
      status: "failed",
      tailoringRun,
      error: { code: "RUN_STOP_FAILED", retryable: true },
    });
    expect(sessionStorage.getItem(LOCAL_AI_ACTIVE_REQUEST_KEY)).toBe(REQUEST_ID);
  });

  it("converges a Hermes failure to cancelled when durable failure replays cancellation", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          disposition: "REPLAYED",
          run: { status: "CANCELLED" },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    bridge.send.mockImplementation(async (action: string) => {
      if (action === "START_RUN") {
        return {
          requestId: REQUEST_ID,
          jobId: JOB_ID,
          target: "resume",
          status: "failed",
          tailoringRun,
          error: {
            code: "HERMES_RUN_FAILED",
            message: "Hermes could not complete this generation.",
            retryable: true,
          },
        };
      }
      throw new Error(`unexpected ${action}`);
    });
    const { result } = renderHook(() =>
      useLocalAiRun({ enabled: true, onSucceeded: vi.fn() }),
    );
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    await act(async () => result.current.start(JOB_ID, "resume"));

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/tailoring-runs/${tailoringRun.id}/fail`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.current.runState).toMatchObject({
      status: "cancelled",
      tailoringRun,
    });
    expect(sessionStorage.getItem(LOCAL_AI_ACTIVE_REQUEST_KEY)).toBeNull();
  });

  it("converges a Hermes cancellation to failed when durable cancellation replays failure", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          disposition: "REPLAYED",
          run: { status: "FAILED" },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    bridge.send.mockImplementation(async (action: string) => {
      if (action === "START_RUN") {
        return {
          requestId: REQUEST_ID,
          jobId: JOB_ID,
          target: "cover",
          status: "cancelled",
          tailoringRun,
        };
      }
      throw new Error(`unexpected ${action}`);
    });
    const { result } = renderHook(() =>
      useLocalAiRun({ enabled: true, onSucceeded: vi.fn() }),
    );
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    await act(async () => result.current.start(JOB_ID, "cover"));

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/tailoring-runs/${tailoringRun.id}/cancel`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.current.runState).toMatchObject({
      status: "failed",
      tailoringRun,
      error: { code: "TAILORING_RUN_FAILED", retryable: false },
    });
    expect(sessionStorage.getItem(LOCAL_AI_ACTIVE_REQUEST_KEY)).toBeNull();
  });

  it("records a terminal Hermes failure against the durable attempt", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ run: { status: "FAILED" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    bridge.send.mockImplementation(async (action: string) => {
      if (action === "GET_STATUS") return { state: "ready", joblitConnected: true };
      if (action === "START_RUN") {
        return {
          requestId: REQUEST_ID,
          jobId: JOB_ID,
          target: "resume",
          status: "queued",
          tailoringRun,
        };
      }
      if (action === "GET_RUN") {
        return {
          requestId: REQUEST_ID,
          jobId: JOB_ID,
          target: "resume",
          status: "failed",
          tailoringRun,
          error: {
            code: "HERMES_RUN_FAILED",
            message: "Hermes could not complete this generation.",
            retryable: true,
          },
        };
      }
      throw new Error(`unexpected ${action}`);
    });
    const { result } = renderHook(() =>
      useLocalAiRun({ enabled: true, onSucceeded: vi.fn() }),
    );
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    await act(async () => result.current.start(JOB_ID, "resume"));

    await waitFor(() => expect(result.current.runState).toMatchObject({
      status: "failed",
      tailoringRun,
      error: { code: "HERMES_RUN_FAILED" },
    }));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/tailoring-runs/${tailoringRun.id}/fail`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          attemptId: tailoringRun.attemptId,
          code: "HERMES_RUN_FAILED",
        }),
      }),
    );
  });

  it("does not stop Hermes when durable cancellation fails", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        error: { code: "ATTEMPT_FENCED", message: "Attempt is stale" },
      }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    bridge.send.mockImplementation(async (action: string) => {
      if (action === "GET_STATUS") return { state: "ready", joblitConnected: true };
      if (action === "START_RUN" || action === "GET_RUN") {
        return {
          requestId: REQUEST_ID,
          jobId: JOB_ID,
          target: "cover",
          status: "queued",
          tailoringRun,
        };
      }
      throw new Error(`unexpected ${action}`);
    });
    const { result } = renderHook(() =>
      useLocalAiRun({ enabled: true, onSucceeded: vi.fn() }),
    );
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    await act(async () => result.current.start(JOB_ID, "cover"));
    await act(async () => result.current.stop());

    expect(result.current.runState).toMatchObject({
      status: "failed",
      tailoringRun,
      error: { code: "RUN_CANCEL_FAILED", retryable: true },
    });
    expect(
      bridge.send.mock.calls.filter(([action]) => action === "STOP_RUN"),
    ).toHaveLength(0);
  });

  it.each([
    ["RUN_START_UNKNOWN", false],
    ["RUN_LOST", true],
  ] as const)("preserves stable %s failures without another START_RUN", async (code, retryable) => {
    bridge.send.mockImplementation(async (action: string) => {
      if (action === "GET_STATUS") return { state: "ready", joblitConnected: true };
      throw new LocalAiBridgeError(code, "redacted", retryable);
    });
    const { result } = renderHook(() => useLocalAiRun({ enabled: true, onSucceeded: vi.fn() }));
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    await act(async () => result.current.start(JOB_ID, "resume"));
    expect(result.current.runState).toMatchObject({ status: "failed", error: { code, retryable } });
    expect(bridge.send.mock.calls.filter(([action]) => action === "START_RUN")).toHaveLength(1);
  });

  it("recovers only the public request ID after refresh", async () => {
    sessionStorage.setItem(LOCAL_AI_ACTIVE_REQUEST_KEY, REQUEST_ID);
    const imported = vi.fn().mockResolvedValue(undefined);
    bridge.send.mockImplementation(async (action: string, payload: unknown) => {
      if (action === "GET_STATUS") return { state: "ready", joblitConnected: true };
      expect(payload).toEqual({ requestId: REQUEST_ID });
      return { requestId: REQUEST_ID, jobId: JOB_ID, target: "resume", status: "succeeded", modelOutput: "{\"validOutput\":true}", promptMeta };
    });
    const { result } = renderHook(() => useLocalAiRun({ enabled: true, onSucceeded: imported }));
    await waitFor(() => expect(result.current.runState.status).toBe("succeeded"));
    expect(imported).toHaveBeenCalledTimes(1);
  });

  it("cleans polling and bridge timeouts on unmount", async () => {
    const { unmount } = renderHook(() => useLocalAiRun({ enabled: true, onSucceeded: vi.fn() }));
    await waitFor(() => expect(bridge.detect).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    const signal = bridge.detect.mock.calls[0]?.[0]?.signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
