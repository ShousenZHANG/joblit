import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ApiRequestError } from "./apiErrors";
import { processQueue } from "./syncProcessor";
import { clearQueue, enqueue, getQueue, markRetry } from "./syncQueue";

const apiMocks = vi.hoisted(() => ({
  postSubmission: vi.fn(),
  putFieldMapping: vi.fn(),
}));

vi.mock("./api", () => apiMocks);

describe("processQueue", () => {
  beforeAll(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await clearQueue();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("removes a permanent failure and counts it as failed", async () => {
    await enqueue("submission", { pageUrl: "https://jobs.example.com/1" });
    apiMocks.postSubmission.mockRejectedValueOnce(
      new ApiRequestError(422, "Submission recording failed: 422"),
    );

    await expect(processQueue()).resolves.toEqual({ synced: 0, failed: 1 });
    expect(await getQueue()).toEqual([]);
  });

  it("removes a permanently rejected field mapping", async () => {
    await enqueue("field_mapping", { fieldKey: "firstName" });
    apiMocks.putFieldMapping.mockRejectedValueOnce(
      new ApiRequestError(400, "Mapping update failed: 400"),
    );

    await expect(processQueue()).resolves.toEqual({ synced: 0, failed: 1 });
    expect(await getQueue()).toEqual([]);
  });

  it("retains and increments a retryable network failure", async () => {
    await enqueue("submission", { pageUrl: "https://jobs.example.com/1" });
    apiMocks.postSubmission.mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );

    await expect(processQueue()).resolves.toEqual({ synced: 0, failed: 0 });
    const queue = await getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].retries).toBe(1);
  });

  it("drops and counts a retryable failure at the existing retry bound", async () => {
    await enqueue("submission", { pageUrl: "https://jobs.example.com/1" });
    const [item] = await getQueue();
    for (let retry = 0; retry < 4; retry++) {
      await markRetry(item.id);
    }
    apiMocks.postSubmission.mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );

    await expect(processQueue()).resolves.toEqual({ synced: 0, failed: 1 });
    expect(await getQueue()).toEqual([]);
  });
});
