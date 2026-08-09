import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/server/dataRetirement/legacyMarketRetirement", () => ({
  LEGACY_MARKET_RETIREMENT_DEFAULTS: { batchSize: 25, maxBatches: 20 },
  retireLegacyMarketData: vi.fn(),
}));

import {
  parseRetirementCliArgs,
  retirementSummaryExitCode,
} from "./retire-legacy-markets";

describe("legacy market retirement CLI", () => {
  it("is dry-run by default and keeps bounded defaults", () => {
    expect(parseRetirementCliArgs([])).toEqual({
      execute: false,
      verify: false,
      batchSize: 25,
      maxBatches: 20,
    });
  });

  it("requires the exact destructive confirmation", () => {
    expect(() => parseRetirementCliArgs(["--execute"])).toThrow(
      "Execution requires",
    );
    expect(
      parseRetirementCliArgs([
        "--execute",
        "--confirm=DELETE_CN_GLOBAL_FETCH_AND_GLOBAL_JOBS",
        "--batch-size=10",
        "--max-batches=2",
      ]),
    ).toEqual({
      execute: true,
      verify: false,
      batchSize: 10,
      maxBatches: 2,
    });
  });

  it("supports a distinct read-only readiness mode", () => {
    expect(parseRetirementCliArgs(["--verify"])).toEqual({
      execute: false,
      verify: true,
      batchSize: 25,
      maxBatches: 20,
    });
  });

  it("rejects ambiguous modes and unbounded values", () => {
    expect(() =>
      parseRetirementCliArgs([
        "--dry-run",
        "--execute",
        "--confirm=DELETE_CN_GLOBAL_FETCH_AND_GLOBAL_JOBS",
      ]),
    ).toThrow("Choose only one");
    expect(() => parseRetirementCliArgs(["--batch-size=101"])).toThrow(
      "between 1 and 100",
    );
  });

  it("fails readiness and incomplete execute modes without failing a preview", () => {
    const ready = { stage2Ready: true, capped: false } as never;
    const notReady = { stage2Ready: false, capped: false } as never;
    const capped = { stage2Ready: false, capped: true } as never;

    expect(
      retirementSummaryExitCode({ execute: false, verify: true }, ready),
    ).toBe(0);
    expect(
      retirementSummaryExitCode({ execute: false, verify: true }, notReady),
    ).toBe(3);
    expect(
      retirementSummaryExitCode({ execute: true, verify: false }, notReady),
    ).toBe(3);
    expect(
      retirementSummaryExitCode({ execute: true, verify: false }, capped),
    ).toBe(3);
    expect(
      retirementSummaryExitCode({ execute: false, verify: false }, notReady),
    ).toBe(0);
  });
});
