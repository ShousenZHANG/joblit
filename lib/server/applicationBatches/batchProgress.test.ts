import { describe, it, expect } from "vitest";
import { taskProgressFromGroupBy, type BatchProgress } from "./batchProgress";

describe("taskProgressFromGroupBy", () => {
  it("returns all-zero counts for empty input", () => {
    const result = taskProgressFromGroupBy([]);
    expect(result).toEqual<BatchProgress>({
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    });
  });

  it("maps each status to its count", () => {
    const rows = [
      { status: "PENDING", _count: { _all: 3 } },
      { status: "RUNNING", _count: { _all: 1 } },
      { status: "SUCCEEDED", _count: { _all: 10 } },
      { status: "FAILED", _count: { _all: 2 } },
      { status: "SKIPPED", _count: { _all: 5 } },
    ];
    const result = taskProgressFromGroupBy(rows);
    expect(result).toEqual<BatchProgress>({
      pending: 3,
      running: 1,
      succeeded: 10,
      failed: 2,
      skipped: 5,
    });
  });

  it("leaves unrepresented statuses at zero", () => {
    const rows = [{ status: "SUCCEEDED", _count: { _all: 7 } }];
    const result = taskProgressFromGroupBy(rows);
    expect(result).toEqual<BatchProgress>({
      pending: 0,
      running: 0,
      succeeded: 7,
      failed: 0,
      skipped: 0,
    });
  });

  it("ignores unknown status values", () => {
    const rows = [
      { status: "UNKNOWN_STATUS", _count: { _all: 99 } },
      { status: "PENDING", _count: { _all: 4 } },
    ];
    const result = taskProgressFromGroupBy(rows);
    expect(result.pending).toBe(4);
    expect(result.running).toBe(0);
    expect(result.succeeded).toBe(0);
  });

  it("uses the last value when the same status appears multiple times", () => {
    const rows = [
      { status: "PENDING", _count: { _all: 1 } },
      { status: "PENDING", _count: { _all: 5 } },
    ];
    const result = taskProgressFromGroupBy(rows);
    // The loop overwrites, so the last value wins
    expect(result.pending).toBe(5);
  });
});
