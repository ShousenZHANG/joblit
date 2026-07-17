import { beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "@ext/shared/constants";
import { HermesApiError } from "./apiErrors";

const runId = "run_0123456789abcdef0123456789abcdef";
const payload = {
  requestId: "550e8400-e29b-41d4-a716-446655440000",
  jobId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
  target: "resume" as const,
};

const api = vi.hoisted(() => ({
  probe: vi.fn(),
  startRun: vi.fn(),
  getRun: vi.fn(),
  stopRun: vi.fn(),
  sessionChat: vi.fn(),
  peekRunProgress: vi.fn().mockResolvedValue(null),
}));

vi.mock("./hermesApi", () => ({ createHermesApi: () => api }));
vi.mock("./api", () => ({
  fetchAiPromptEnvelope: vi.fn().mockResolvedValue({
    prompt: { input: "generate grounded JSON", instructions: "strict rules", sessionId: "server-session" },
    promptMeta: { promptHash: "sha256:test" },
    promptVersion: "v3-local-ai",
  }),
}));
vi.mock("./auth", () => ({
  getAuthStatus: vi.fn().mockResolvedValue({ authenticated: true, userId: null, expiresAt: null }),
}));

describe("Hermes run registry", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    await chrome.storage.local.set({
      [STORAGE_KEYS.HERMES_API_BASE]: "http://127.0.0.1:8642",
      [STORAGE_KEYS.HERMES_API_KEY]: "0123456789abcdef0123456789abcdef",
      [STORAGE_KEYS.HERMES_PROFILE_NAME]: "joblit-0123456789abcdef",
    });
    api.startRun.mockResolvedValue({ runId });
  });

  it("starts once, keeps the private run id in session storage, and returns public state", async () => {
    const { startLocalAiRun } = await import("./hermesRuns");
    await expect(startLocalAiRun(payload)).resolves.toEqual({ ...payload, status: "queued" });
    await expect(startLocalAiRun(payload)).resolves.toEqual({ ...payload, status: "queued" });
    expect(api.startRun).toHaveBeenCalledTimes(1);
    const stored = await chrome.storage.local.get(STORAGE_KEYS.HERMES_RUN_REGISTRY);
    expect(JSON.stringify(stored)).toContain(runId);
  });

  it("returns one bounded terminal result with prompt metadata", async () => {
    api.getRun.mockResolvedValue({
      object: "hermes.run",
      runId,
      status: "completed",
      output: JSON.stringify({ summary: "A grounded result long enough" }),
    });
    const { getLocalAiRun, startLocalAiRun } = await import("./hermesRuns");
    await startLocalAiRun(payload);
    await expect(getLocalAiRun({ requestId: payload.requestId })).resolves.toMatchObject({
      ...payload,
      status: "succeeded",
      promptMeta: { promptHash: "sha256:test" },
    });
  });

  it("marks an ambiguous start and never retries it", async () => {
    api.startRun.mockRejectedValue(
      new HermesApiError("HERMES_UNREACHABLE", "timeout", { retryable: true, ambiguousStart: true }),
    );
    const { startLocalAiRun } = await import("./hermesRuns");
    await expect(startLocalAiRun(payload)).rejects.toMatchObject({ code: "RUN_START_UNKNOWN" });
    await expect(startLocalAiRun(payload)).rejects.toMatchObject({ code: "RUN_START_UNKNOWN" });
    expect(api.startRun).toHaveBeenCalledTimes(1);
  });

  it("stops and fails closed when an approval appears", async () => {
    api.getRun.mockResolvedValue({ object: "hermes.run", runId, status: "waiting_for_approval" });
    const { getLocalAiRun, startLocalAiRun } = await import("./hermesRuns");
    await startLocalAiRun(payload);
    await expect(getLocalAiRun({ requestId: payload.requestId })).resolves.toMatchObject({
      status: "failed",
      error: { code: "UNEXPECTED_APPROVAL_REQUIRED", retryable: false },
    });
    expect(api.stopRun).toHaveBeenCalledWith(runId);
  });

  it("surfaces best-effort progress for a running run", async () => {
    api.getRun.mockResolvedValue({ object: "hermes.run", runId, status: "running" });
    api.peekRunProgress.mockResolvedValue(420);
    const { getLocalAiRun, startLocalAiRun } = await import("./hermesRuns");
    await startLocalAiRun(payload);
    await expect(getLocalAiRun({ requestId: payload.requestId })).resolves.toMatchObject({
      status: "running",
      progressChars: 420,
    });
  });

  it("repairs once via session chat and refuses a second repair", async () => {
    api.getRun.mockResolvedValue({
      object: "hermes.run",
      runId,
      status: "completed",
      output: JSON.stringify({ summary: "A grounded result long enough" }),
    });
    const { getLocalAiRun, repairLocalAiRun, startLocalAiRun } = await import("./hermesRuns");
    await startLocalAiRun(payload);
    await getLocalAiRun({ requestId: payload.requestId });

    const repairedOutput = JSON.stringify({ summary: "A corrected grounded result" });
    api.sessionChat.mockResolvedValue(repairedOutput);
    await expect(
      repairLocalAiRun({ requestId: payload.requestId, feedback: "cvSummary was too long" }),
    ).resolves.toMatchObject({ status: "running" });

    await vi.waitFor(async () => {
      const result = await getLocalAiRun({ requestId: payload.requestId });
      expect(result.status).toBe("succeeded");
    });
    await expect(getLocalAiRun({ requestId: payload.requestId })).resolves.toMatchObject({
      status: "succeeded",
      modelOutput: repairedOutput,
      promptMeta: { promptHash: "sha256:test" },
    });
    expect(api.sessionChat).toHaveBeenCalledTimes(1);
    expect(api.sessionChat.mock.calls[0][0]).toBe(`joblit:${payload.requestId}`);
    await expect(
      repairLocalAiRun({ requestId: payload.requestId, feedback: "again" }),
    ).rejects.toMatchObject({ code: "HERMES_PROTOCOL_ERROR" });
  });

  it("fails a repair fast after a service-worker restart", async () => {
    api.getRun.mockResolvedValue({
      object: "hermes.run",
      runId,
      status: "completed",
      output: JSON.stringify({ summary: "A grounded result long enough" }),
    });
    api.sessionChat.mockReturnValue(new Promise(() => undefined));
    const first = await import("./hermesRuns");
    await first.startLocalAiRun(payload);
    await first.getLocalAiRun({ requestId: payload.requestId });
    await first.repairLocalAiRun({ requestId: payload.requestId, feedback: "fix the schema" });

    vi.resetModules();
    const restarted = await import("./hermesRuns");
    await expect(
      restarted.getLocalAiRun({ requestId: payload.requestId }),
    ).resolves.toMatchObject({
      status: "failed",
      error: { code: "AI_OUTPUT_INVALID" },
    });
  });
});
