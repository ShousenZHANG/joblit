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

type RuntimeMessageListener = (
  message: MessageType,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: MessageResponse) => void,
) => boolean | void;

let runtimeMessageListener: RuntimeMessageListener | undefined;

async function dispatchMessage(message: MessageType): Promise<MessageResponse> {
  if (!runtimeMessageListener) throw new Error("Runtime listener not registered");

  return new Promise((resolve) => {
    const keepsChannelOpen = runtimeMessageListener?.(
      message,
      {} as chrome.runtime.MessageSender,
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
});
