import { beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "@ext/shared/constants";
import { HermesApiError } from "./apiErrors";

const runId = "run_0123456789abcdef0123456789abcdef";
const payload = {
  requestId: "550e8400-e29b-41d4-a716-446655440000",
  jobId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
  target: "resume" as const,
};

const promptApi = vi.hoisted(() => {
  const tailoringRun = {
    id: "8f8f8f8f-8f8f-4f8f-8f8f-8f8f8f8f8f8f",
    attemptId: "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a",
  };
  const prompt = {
    input: "generate grounded JSON",
    instructions: "strict rules",
    sessionId: "server-session",
  };
  const baseEnvelope = {
    prompt,
    promptMeta: { promptHash: "sha256:test" },
    promptVersion: "v4-application-proposal",
  };
  return {
    tailoringRun,
    applicationEnvelope: { ...baseEnvelope, tailoringRun },
    otherEnvelope: baseEnvelope,
    fetchApplication: vi.fn(),
    fetchTriage: vi.fn(),
  };
});

const remoteDefaults = vi.hoisted(() => ({
  fetch: vi.fn().mockResolvedValue(null),
  push: vi.fn().mockResolvedValue(undefined),
}));

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
    fetchAiPromptEnvelope: promptApi.fetchApplication,
    fetchAiTriagePromptEnvelope: promptApi.fetchTriage,
    fetchLocalAiDefaults: remoteDefaults.fetch,
    pushLocalAiDefaults: remoteDefaults.push,
}));
vi.mock("./auth", () => ({
  getAuthStatus: vi.fn().mockResolvedValue({ authenticated: true, userId: null, expiresAt: null }),
}));

describe("Hermes run registry", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    promptApi.fetchApplication.mockImplementation(async (input: { target: string }) =>
      input.target === "match"
        ? promptApi.otherEnvelope
        : promptApi.applicationEnvelope,
    );
    promptApi.fetchTriage.mockResolvedValue(promptApi.otherEnvelope);
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    await chrome.storage.local.set({
      [STORAGE_KEYS.HERMES_API_BASE]: "http://127.0.0.1:8642",
      [STORAGE_KEYS.HERMES_API_KEY]: "0123456789abcdef0123456789abcdef",
      [STORAGE_KEYS.HERMES_PROFILE_NAME]: "joblit-0123456789abcdef",
    });
    api.startRun.mockResolvedValue({ runId });
    api.peekRunProgress.mockResolvedValue(null);
  });

  it("issues once, persists the TailoringRun handle with the private mapping, and returns public state", async () => {
    const { startLocalAiRun } = await import("./hermesRuns");
    const publicRun = await startLocalAiRun(payload);
    expect(publicRun).toEqual({
      ...payload,
      status: "queued",
      tailoringRun: promptApi.tailoringRun,
    });
    await expect(startLocalAiRun(payload)).resolves.toEqual({
      ...payload,
      status: "queued",
      tailoringRun: promptApi.tailoringRun,
    });
    expect(api.startRun).toHaveBeenCalledTimes(1);
    expect(promptApi.fetchApplication).toHaveBeenCalledWith({
      jobId: payload.jobId,
      target: payload.target,
      issueKey: payload.requestId,
    });
    const stored = await chrome.storage.local.get(STORAGE_KEYS.HERMES_RUN_REGISTRY);
    expect(stored[STORAGE_KEYS.HERMES_RUN_REGISTRY]).toMatchObject({
      [payload.requestId]: {
        runId,
        tailoringRun: promptApi.tailoringRun,
      },
    });
    expect(JSON.stringify(publicRun)).not.toContain(runId);
    expect(JSON.stringify(publicRun)).not.toContain("server-session");
  });

  it("returns one bounded terminal result with prompt metadata and its TailoringRun handle", async () => {
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
      tailoringRun: promptApi.tailoringRun,
    });
  });

  it.each([
    ["missing", undefined],
    [
      "malformed",
      { ...promptApi.tailoringRun, attemptId: "private-session-id" },
    ],
  ])("rejects a %s TailoringRun handle before starting Hermes", async (_label, tailoringRun) => {
    promptApi.fetchApplication.mockResolvedValueOnce({
      ...promptApi.otherEnvelope,
      ...(tailoringRun === undefined ? {} : { tailoringRun }),
    });
    const { startLocalAiRun } = await import("./hermesRuns");

    await expect(startLocalAiRun(payload)).rejects.toMatchObject({
      code: "HERMES_PROTOCOL_ERROR",
    });
    expect(api.startRun).not.toHaveBeenCalled();
  });

  it("accepts the explicitly marked legacy prompt envelope during cutover", async () => {
    promptApi.fetchApplication.mockResolvedValueOnce({
      ...promptApi.otherEnvelope,
      legacyTailoringRunProtocol: true,
    });
    const { startLocalAiRun } = await import("./hermesRuns");

    await expect(startLocalAiRun(payload)).resolves.toEqual({
      ...payload,
      status: "queued",
    });
    expect(api.startRun).toHaveBeenCalledTimes(1);
  });

  it("preserves the public handle for an ambiguous start without retrying it", async () => {
    api.startRun.mockRejectedValue(
      new HermesApiError("HERMES_UNREACHABLE", "timeout", { retryable: true, ambiguousStart: true }),
    );
    const { getLocalAiRun, startLocalAiRun, stopLocalAiRun } = await import("./hermesRuns");
    await expect(startLocalAiRun(payload)).resolves.toMatchObject({
      ...payload,
      status: "queued",
      tailoringRun: promptApi.tailoringRun,
    });
    await expect(startLocalAiRun(payload)).resolves.toMatchObject({
      status: "queued",
      tailoringRun: promptApi.tailoringRun,
    });
    await expect(
      getLocalAiRun({ requestId: payload.requestId }),
    ).resolves.toMatchObject({
      status: "queued",
      tailoringRun: promptApi.tailoringRun,
    });
    await expect(
      stopLocalAiRun({ requestId: payload.requestId }),
    ).resolves.toMatchObject({
      status: "cancelled",
      tailoringRun: promptApi.tailoringRun,
    });
    expect(api.startRun).toHaveBeenCalledTimes(1);
    expect(api.stopRun).not.toHaveBeenCalled();
  });

  it("retains the durable handle when Hermes definitely fails to start", async () => {
    api.startRun.mockRejectedValue(
      new HermesApiError("HERMES_UNREACHABLE", "connection refused", {
        retryable: true,
      }),
    );
    const { getLocalAiRun, startLocalAiRun } = await import("./hermesRuns");

    await expect(startLocalAiRun(payload)).resolves.toMatchObject({
      ...payload,
      status: "failed",
      tailoringRun: promptApi.tailoringRun,
      error: { code: "HERMES_RUN_FAILED", retryable: true },
    });
    await expect(
      getLocalAiRun({ requestId: payload.requestId }),
    ).resolves.toMatchObject({
      status: "failed",
      tailoringRun: promptApi.tailoringRun,
    });
    expect(api.startRun).toHaveBeenCalledTimes(1);
  });

  it("stops and fails closed when an approval appears", async () => {
    api.getRun.mockResolvedValue({ object: "hermes.run", runId, status: "waiting_for_approval" });
    const { getLocalAiRun, startLocalAiRun } = await import("./hermesRuns");
    await startLocalAiRun(payload);
    await expect(getLocalAiRun({ requestId: payload.requestId })).resolves.toMatchObject({
      status: "failed",
      error: { code: "UNEXPECTED_APPROVAL_REQUIRED", retryable: false },
      tailoringRun: promptApi.tailoringRun,
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
      tailoringRun: promptApi.tailoringRun,
    });
  });

  it("returns the TailoringRun handle while stopping and after cancellation", async () => {
    const { getLocalAiRun, startLocalAiRun, stopLocalAiRun } = await import("./hermesRuns");
    await startLocalAiRun(payload);
    await expect(stopLocalAiRun({ requestId: payload.requestId })).resolves.toMatchObject({
      status: "stopping",
      tailoringRun: promptApi.tailoringRun,
    });

    api.getRun.mockResolvedValue({
      object: "hermes.run",
      runId,
      status: "cancelled",
    });
    await expect(getLocalAiRun({ requestId: payload.requestId })).resolves.toMatchObject({
      status: "cancelled",
      tailoringRun: promptApi.tailoringRun,
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
      tailoringRun: promptApi.tailoringRun,
    });
    expect(api.sessionChat).toHaveBeenCalledTimes(1);
    expect(api.sessionChat.mock.calls[0][0]).toBe(`joblit:${payload.requestId}`);
    await expect(
      repairLocalAiRun({ requestId: payload.requestId, feedback: "again" }),
    ).rejects.toMatchObject({ code: "HERMES_PROTOCOL_ERROR" });
  });

  it("keeps a triage batch entry across registry reads and returns its output", async () => {
    const triagePayload = {
      requestId: payload.requestId,
      jobId: payload.jobId,
      target: "triage" as const,
      jobIds: [payload.jobId, "9114d0b0-a6e3-4d3a-94f0-bc792eba35f5"],
    };
    api.getRun.mockResolvedValue({
      object: "hermes.run",
      runId,
      status: "completed",
      output: JSON.stringify([
        { jobId: triagePayload.jobIds[0], matchScore: 70 },
        { jobId: triagePayload.jobIds[1], matchScore: 15 },
      ]),
    });
    const { getLocalAiRun, startLocalAiRun } = await import("./hermesRuns");
    await expect(startLocalAiRun(triagePayload)).resolves.toMatchObject({
      status: "queued",
      target: "triage",
    });
    // The registry read on the next poll must not discard the triage entry.
    const result = await getLocalAiRun({ requestId: payload.requestId });
    expect(result).toMatchObject({
      status: "succeeded",
      target: "triage",
      modelOutput: expect.stringContaining("matchScore"),
    });
    expect(result).not.toHaveProperty("tailoringRun");
  });

  it("does not require a TailoringRun handle for match runs", async () => {
    const matchPayload = { ...payload, target: "match" as const };
    const { startLocalAiRun } = await import("./hermesRuns");

    await expect(startLocalAiRun(matchPayload)).resolves.toEqual({
      ...matchPayload,
      status: "queued",
    });
    expect(promptApi.fetchApplication).toHaveBeenCalledWith({
      jobId: matchPayload.jobId,
      target: "match",
      issueKey: matchPayload.requestId,
    });
  });

  it("converts a Hermes-expired run into a terminal RUN_LOST instead of endless retries", async () => {
    api.getRun.mockRejectedValue(
      new HermesApiError("HERMES_RUN_NOT_FOUND", "gone", { status: 404, retryable: true }),
    );
    const { getLocalAiRun, startLocalAiRun } = await import("./hermesRuns");
    await startLocalAiRun(payload);
    await expect(getLocalAiRun({ requestId: payload.requestId })).resolves.toMatchObject({
      status: "failed",
      error: { code: "RUN_LOST", retryable: false },
      tailoringRun: promptApi.tailoringRun,
    });
    // Terminal result is sticky; no further Hermes calls needed.
    await expect(getLocalAiRun({ requestId: payload.requestId })).resolves.toMatchObject({
      status: "failed",
      error: { code: "RUN_LOST" },
      tailoringRun: promptApi.tailoringRun,
    });
  });

  it("recovers the TailoringRun handle after a service-worker restart", async () => {
    api.getRun.mockResolvedValue({
      object: "hermes.run",
      runId,
      status: "running",
    });
    const first = await import("./hermesRuns");
    await first.startLocalAiRun(payload);

    vi.resetModules();
    const restarted = await import("./hermesRuns");
    await expect(
      restarted.getLocalAiRun({ requestId: payload.requestId }),
    ).resolves.toMatchObject({
      status: "running",
      tailoringRun: promptApi.tailoringRun,
    });
  });

  it("keeps a legacy active registry entry without a TailoringRun handle readable", async () => {
    api.getRun.mockResolvedValue({
      object: "hermes.run",
      runId,
      status: "running",
    });
    const first = await import("./hermesRuns");
    await first.startLocalAiRun(payload);
    const stored = await chrome.storage.local.get(STORAGE_KEYS.HERMES_RUN_REGISTRY);
    const registry = structuredClone(
      stored[STORAGE_KEYS.HERMES_RUN_REGISTRY],
    ) as Record<string, Record<string, unknown>>;
    delete registry[payload.requestId].tailoringRun;
    await chrome.storage.local.set({
      [STORAGE_KEYS.HERMES_RUN_REGISTRY]: registry,
    });

    vi.resetModules();
    const restarted = await import("./hermesRuns");
    await expect(
      restarted.getLocalAiRun({ requestId: payload.requestId }),
    ).resolves.toEqual({
      ...payload,
      status: "running",
    });
  });

  it("prefills endpoint and profile from Joblit on a fresh install, key stays local", async () => {
    await chrome.storage.local.clear();
    remoteDefaults.fetch.mockResolvedValueOnce({
      hermesEndpoint: "http://127.0.0.1:9700",
      hermesProfile: "joblit-f1742d0bc521469b",
    });
    const { getHermesSettingsPublic } = await import("./hermesRuns");
    await expect(getHermesSettingsPublic()).resolves.toEqual({
      baseUrl: "http://127.0.0.1:9700",
      profileName: "joblit-f1742d0bc521469b",
      hasApiKey: false,
      configured: false,
    });
  });

  it("never lets remote defaults override locally saved settings", async () => {
    remoteDefaults.fetch.mockResolvedValue({
      hermesEndpoint: "http://127.0.0.1:9999",
      hermesProfile: "joblit-ffffffffffffffff",
    });
    const { getHermesSettingsPublic } = await import("./hermesRuns");
    const settings = await getHermesSettingsPublic();
    expect(settings.baseUrl).toBe("http://127.0.0.1:8642");
    expect(settings.profileName).toBe("joblit-0123456789abcdef");
    expect(remoteDefaults.fetch).not.toHaveBeenCalled();
  });

  it("syncs non-secret defaults to Joblit after a successful save", async () => {
    api.probe.mockResolvedValue({ modelId: "joblit-0123456789abcdef", profileName: "joblit-0123456789abcdef", tools: [] });
    const { testAndSaveHermesSettings } = await import("./hermesRuns");
    await testAndSaveHermesSettings({
      baseUrl: "http://127.0.0.1:8642",
      profileName: "joblit-0123456789abcdef",
      apiKey: "0123456789abcdef0123456789abcdef",
    });
    await vi.waitFor(() => {
      expect(remoteDefaults.push).toHaveBeenCalledWith({
        hermesEndpoint: "http://127.0.0.1:8642",
        hermesProfile: "joblit-0123456789abcdef",
      });
    });
    const pushed = JSON.stringify(remoteDefaults.push.mock.calls);
    expect(pushed).not.toContain("0123456789abcdef0123456789abcdef");
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
