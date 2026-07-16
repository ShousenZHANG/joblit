import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { MessageResponse, MessageType } from "@ext/shared/types";
import { ApiRequestError } from "./apiErrors";

const apiMocks = vi.hoisted(() => ({
  fetchFieldMappings: vi.fn(),
  fetchFlatProfile: vi.fn(),
  fetchProfile: vi.fn(),
  fetchSubmissions: vi.fn(),
  importSeekJobs: vi.fn(),
  markJobApplied: vi.fn(),
  matchJob: vi.fn(),
  postSubmission: vi.fn(),
  putFieldMapping: vi.fn(),
}));

const queueMocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  processQueue: vi.fn(),
}));

const hermesMocks = vi.hoisted(() => ({
  checkHermesSettings: vi.fn(),
  forgetHermesSettings: vi.fn(),
  getHermesSettingsPublic: vi.fn(),
  getLocalAiRun: vi.fn(),
  getPublicLocalAiStatus: vi.fn(),
  startLocalAiRun: vi.fn(),
  stopLocalAiRun: vi.fn(),
  testAndSaveHermesSettings: vi.fn(),
}));

vi.mock("./api", () => apiMocks);
vi.mock("./auth", () => ({
  clearToken: vi.fn(),
  getAuthStatus: vi.fn(),
  setToken: vi.fn(),
}));
vi.mock("./syncQueue", () => ({ enqueue: queueMocks.enqueue }));
vi.mock("./syncProcessor", () => ({
  processQueue: queueMocks.processQueue,
}));
vi.mock("./tabBridge", () => ({ sendToActiveTab: vi.fn() }));
vi.mock("./storageSecurity", () => ({
  ensureTrustedLocalStorage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./hermesRuns", () => hermesMocks);

type RuntimeMessageListener = (
  message: MessageType,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: MessageResponse) => void,
) => boolean | void;

let runtimeMessageListener: RuntimeMessageListener | undefined;

async function dispatchMessage(
  message: MessageType,
  sender = {} as chrome.runtime.MessageSender,
): Promise<MessageResponse> {
  if (!runtimeMessageListener) throw new Error("Runtime listener not registered");

  return new Promise((resolve) => {
    const keepsChannelOpen = runtimeMessageListener?.(
      message,
      sender,
      resolve,
    );
    expect(keepsChannelOpen).toBe(true);
  });
}

describe("service worker retry queue policy", () => {
  beforeAll(async () => {
    vi.stubEnv("NODE_ENV", "production");
    Object.assign(chrome.runtime.onMessage, {
      addListener: vi.fn((listener: RuntimeMessageListener) => {
        runtimeMessageListener = listener;
      }),
    });
    await import("./service-worker");
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("does not enqueue a permanently rejected submission", async () => {
    const payload = { pageUrl: "https://jobs.example.com/apply/1" };
    apiMocks.postSubmission.mockRejectedValueOnce(
      new ApiRequestError(422, "Submission recording failed: 422"),
    );

    const response = await dispatchMessage({
      type: "RECORD_SUBMISSION",
      data: payload,
    });

    expect(queueMocks.enqueue).not.toHaveBeenCalled();
    expect(response).toEqual({
      success: false,
      error: "Submission recording failed: 422",
    });
  });

  it("keeps offline recovery for a transient submission failure", async () => {
    const payload = { pageUrl: "https://jobs.example.com/apply/1" };
    apiMocks.postSubmission.mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );

    const response = await dispatchMessage({
      type: "RECORD_SUBMISSION",
      data: payload,
    });

    expect(queueMocks.enqueue).toHaveBeenCalledWith("submission", payload);
    expect(response).toEqual({ success: true });
  });

  it("does not enqueue a permanently rejected field mapping", async () => {
    const payload = { fieldKey: "firstName" };
    apiMocks.putFieldMapping.mockRejectedValueOnce(
      new ApiRequestError(400, "Mapping update failed: 400"),
    );

    const response = await dispatchMessage({
      type: "PUT_FIELD_MAPPING",
      data: payload,
    });

    expect(queueMocks.enqueue).not.toHaveBeenCalled();
    expect(response).toEqual({
      success: false,
      error: "Mapping update failed: 400",
    });
  });

  it("accepts Local AI run actions only from the exact Joblit content script", async () => {
    const run = {
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      jobId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
      target: "resume" as const,
      status: "queued" as const,
    };
    hermesMocks.startLocalAiRun.mockResolvedValueOnce(run);
    const message: MessageType = { type: "LOCAL_AI_START_RUN", payload: run };

    await expect(dispatchMessage(message, {
      id: chrome.runtime.id,
      url: "https://www.joblit.tech/jobs",
      tab: { id: 7, url: "https://www.joblit.tech/jobs" } as chrome.tabs.Tab,
    })).resolves.toEqual({ success: true, data: run });

    await expect(dispatchMessage(message, {
      id: chrome.runtime.id,
      url: "https://evil.example/jobs",
      tab: { id: 8, url: "https://evil.example/jobs" } as chrome.tabs.Tab,
    })).resolves.toMatchObject({ success: false, errorCode: "FORBIDDEN_CALLER" });
  });
});
