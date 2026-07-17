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

const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440000";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
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
      if (action === "START_RUN") return { requestId: REQUEST_ID, jobId: JOB_ID, target: "resume", status: "queued" };
      if (action === "GET_RUN") {
        getRunCalls += 1;
        if (getRunCalls === 1) return { requestId: REQUEST_ID, jobId: JOB_ID, target: "resume", status: "running" };
        return { requestId: REQUEST_ID, jobId: JOB_ID, target: "resume", status: "succeeded", modelOutput: "{\"validOutput\":true}", promptMeta };
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
    expect(sessionStorage.getItem(LOCAL_AI_ACTIVE_REQUEST_KEY)).toBeNull();
  });

  it("stops an active run and exposes cancellation", async () => {
    bridge.send.mockImplementation(async (action: string) => {
      if (action === "GET_STATUS") return { state: "ready", joblitConnected: true };
      if (action === "START_RUN" || action === "GET_RUN") return { requestId: REQUEST_ID, jobId: JOB_ID, target: "cover", status: "queued" };
      if (action === "STOP_RUN") return { requestId: REQUEST_ID, jobId: JOB_ID, target: "cover", status: "cancelled" };
    });
    const { result } = renderHook(() => useLocalAiRun({ enabled: true, onSucceeded: vi.fn() }));
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    await act(async () => result.current.start(JOB_ID, "cover"));
    await act(async () => result.current.stop());
    expect(result.current.runState.status).toBe("cancelled");
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
