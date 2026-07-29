import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  runCnFetch: vi.fn(),
}));

vi.mock("./runCnFetch", () => ({ runCnFetch: harness.runCnFetch }));

import { discoverCnFetchRun } from "./processFetchRun";

const input = {
  userId: "user-1",
  queries: {
    queries: ["Java Engineer"],
    sources: ["nowcoder"],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("discoverCnFetchRun", () => {
  it("normalizes discoveries into a terminal commit plan", async () => {
    const row = {
      jobUrl: "https://www.nowcoder.com/jobs/detail/1",
      title: "Java Backend Engineer",
      company: "Acme",
      location: "Shanghai",
      jobType: "fulltime",
      jobLevel: "junior",
      description: "Java Spring",
      listingDate: "2026-07-20T00:00:00.000Z",
      market: "CN" as const,
      source: "nowcoder" as const,
    };
    harness.runCnFetch.mockResolvedValue({ jobs: [row], diagnostics: [] });

    const result = await discoverCnFetchRun(input);

    expect(result).toEqual({
      kind: "commit",
      batchKey: "cn-result-v1",
      items: [row],
      discovered: 1,
      terminalOutcome: "SUCCEEDED",
    });
  });

  it("returns an empty successful commit plan for a healthy empty source", async () => {
    harness.runCnFetch.mockResolvedValue({ jobs: [], diagnostics: [] });

    const result = await discoverCnFetchRun(input);

    expect(result).toEqual({
      kind: "commit",
      batchKey: "cn-result-v1",
      items: [],
      discovered: 0,
      terminalOutcome: "SUCCEEDED",
    });
  });

  it("returns a failure plan when every configured source failed", async () => {
    harness.runCnFetch.mockResolvedValue({
      jobs: [],
      diagnostics: [
        {
          source: "nowcoder",
          ok: false,
          raw: 0,
          error: "nowcoder_503",
        },
      ],
    });

    const result = await discoverCnFetchRun(input);

    expect(result).toEqual({
      kind: "fail",
      error: "all sources failed: nowcoder: nowcoder_503",
    });
  });

  it("projects mixed source diagnostics as a partial terminal commit", async () => {
    const row = {
      jobUrl: "https://www.nowcoder.com/jobs/detail/1",
      title: "Java Engineer",
      market: "CN" as const,
      source: "nowcoder" as const,
    };
    harness.runCnFetch.mockResolvedValue({
      jobs: [row],
      diagnostics: [
        { source: "nowcoder", ok: true, raw: 1 },
        { source: "other", ok: false, raw: 0, error: "timeout" },
      ],
    });

    const result = await discoverCnFetchRun(input);

    expect(result).toMatchObject({
      kind: "commit",
      items: [row],
      discovered: 1,
      terminalOutcome: "PARTIAL",
      error: "other: timeout",
    });
  });

  it("lets discovery exceptions reach the executor recovery policy", async () => {
    harness.runCnFetch.mockRejectedValue(new Error("source timeout"));

    await expect(discoverCnFetchRun(input)).rejects.toThrow("source timeout");
  });
});
