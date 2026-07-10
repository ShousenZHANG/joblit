import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "@ext/shared/constants";
import {
  fetchFieldMappings,
  fetchFlatProfile,
  fetchProfile,
  fetchSubmissions,
  importSeekJobs,
  markJobApplied,
  matchJob,
  postSubmission,
  putFieldMapping,
} from "./api";
import { ApiRequestError, isRetryableApiError } from "./apiErrors";

describe("ApiRequestError", () => {
  it("retains the HTTP status and message", () => {
    const error = new ApiRequestError(422, "Submission recording failed: 422");

    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(422);
    expect(error.message).toBe("Submission recording failed: 422");
  });
});

describe("isRetryableApiError", () => {
  it("retries network TypeError failures", () => {
    expect(isRetryableApiError(new TypeError("Failed to fetch"))).toBe(true);
  });

  it.each(["TimeoutError", "AbortError"])(
    "retries API client %s failures",
    (name) => {
      const error = new Error("Request timed out");
      error.name = name;

      expect(isRetryableApiError(error)).toBe(true);
    },
  );

  it.each([408, 425, 429, 500, 503])(
    "retries HTTP %i failures",
    (status) => {
      expect(isRetryableApiError(new ApiRequestError(status, "failed"))).toBe(
        true,
      );
    },
  );

  it.each([400, 401, 403, 404, 422])(
    "does not retry permanent HTTP %i failures",
    (status) => {
      expect(isRetryableApiError(new ApiRequestError(status, "failed"))).toBe(
        false,
      );
    },
  );

  it("does not retry unrelated failures", () => {
    expect(isRetryableApiError(new Error("Invalid local state"))).toBe(false);
    expect(isRetryableApiError("failed")).toBe(false);
  });
});

describe("API client failures", () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      [STORAGE_KEYS.AUTH_TOKEN]: "test-token",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["profile fetch", () => fetchProfile()],
    ["flat profile fetch", () => fetchFlatProfile("en-AU", true)],
    ["submission recording", () => postSubmission({})],
    ["submission history", () => fetchSubmissions({})],
    ["field mappings fetch", () => fetchFieldMappings({})],
    ["job matching", () => matchJob("https://jobs.example.com/1")],
    ["mark applied", () => markJobApplied("job-id")],
    ["Seek import", () => importSeekJobs([])],
    ["field mapping update", () => putFieldMapping({})],
  ])("throws a typed status for a non-OK %s response", async (_name, call) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 422 })),
    );

    await expect(call()).rejects.toEqual(
      expect.objectContaining({
        name: "ApiRequestError",
        status: 422,
      }),
    );
  });

  it("turns a client abort into a retryable timeout failure", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const error = await postSubmission({}).catch((caught: unknown) => caught);

    expect(error).toEqual(
      expect.objectContaining({
        name: "TimeoutError",
        message: "Request timed out after 15s",
      }),
    );
    expect(isRetryableApiError(error)).toBe(true);
  });
});
