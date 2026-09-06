import { afterEach, describe, expect, it, vi } from "vitest";
import { companionRequest, isTaskRunning, parseTask } from "./companionClient";

describe("companion protocol boundary", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it.each([["pending", "queued"], ["running", "generating"], ["repair", "repairing"], ["cancelling", "cancelling"]])("normalizes %s without treating it as finished", (received, expected) => {
    const task = parseTask({ taskId: "task", jobId: "job", target: "resume", status: received });
    expect(task?.status).toBe(expected);
    expect(isTaskRunning(task)).toBe(true);
  });

  it("rejects an incomplete completed response instead of announcing a nonexistent PDF", () => {
    expect(() => parseTask({ taskId: "task", jobId: "job", target: "resume", status: "completed", result: { applicationId: "application" } })).toThrow(/PDF receipt/);
  });

  it("sends bearer credentials only to the fixed loopback destination", async () => {
    localStorage.setItem("joblit.sidecarOrigin", "https://untrusted.example");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await companionRequest("/status", { token: "local-pairing-token" });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8791/status", expect.objectContaining({ credentials: "omit", headers: { Authorization: "Bearer local-pairing-token" } }));
    localStorage.removeItem("joblit.sidecarOrigin");
  });

  it("distinguishes an authorization response from ambiguous network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Pair again" } }), { status: 401 })));
    await expect(companionRequest("/status")).rejects.toMatchObject({ code: "permission", status: 401 });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(companionRequest("/status")).rejects.toMatchObject({ code: "network" });
  });

  it("bounds a stalled request and reports timeout separately", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const response = companionRequest("/status", { timeoutMs: 100 });
    const assertion = expect(response).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });
});
