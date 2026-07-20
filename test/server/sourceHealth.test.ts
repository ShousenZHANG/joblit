import { describe, expect, it } from "vitest";
import {
  advanceSourceHealth,
  classifySourceFailure,
  computeConsecutiveFailures,
  computeSourceHealth,
  observationFromDiagnostic,
  toPersistedSourceHealthStatus,
  type SourceHealthObservation,
} from "@/lib/server/sources/sourceHealth";

function observation(
  kind: SourceHealthObservation["kind"],
  hour: number,
): SourceHealthObservation {
  return { kind, checkedAt: `2026-07-20T${String(hour).padStart(2, "0")}:00:00Z` };
}

describe("source health", () => {
  it("resets consecutive failures on reachable and legitimate empty results", () => {
    expect(
      computeConsecutiveFailures([
        observation("network", 1),
        observation("slug_gone", 2),
        observation("empty", 3),
        observation("network", 4),
      ]),
    ).toBe(1);
  });

  it("moves from degraded to unhealthy and recovers", () => {
    const failed = [
      observation("reachable", 1),
      observation("network", 2),
      observation("timeout", 3),
      observation("slug_gone", 4),
    ];
    expect(computeSourceHealth(failed)).toMatchObject({
      status: "unhealthy",
      consecutiveFailures: 3,
      lastReachableAt: "2026-07-20T01:00:00Z",
      lastFailureAt: "2026-07-20T04:00:00Z",
      reason: "slug_gone",
    });
    expect(
      computeSourceHealth([...failed, observation("empty", 5)]),
    ).toMatchObject({
      status: "healthy",
      consecutiveFailures: 0,
      reason: "empty",
    });
  });

  it("advances a compact persisted snapshot and maps diagnostics", () => {
    const first = advanceSourceHealth(
      null,
      observationFromDiagnostic(
        { ok: false, raw: 0, error: "HTTP 503" },
        "2026-07-20T01:00:00Z",
      ),
    );
    const second = advanceSourceHealth(
      first,
      observation("network", 2),
    );
    expect(second).toMatchObject({
      status: "degraded",
      consecutiveFailures: 2,
      lastFailureAt: "2026-07-20T02:00:00Z",
    });
    expect(
      observationFromDiagnostic(
        { ok: true, raw: 0 },
        "2026-07-20T03:00:00Z",
      ).kind,
    ).toBe("empty");
  });

  it("returns unknown without observations", () => {
    expect(computeSourceHealth([])).toMatchObject({
      status: "unknown",
      consecutiveFailures: 0,
    });
    expect(toPersistedSourceHealthStatus("unhealthy")).toBe("DOWN");
  });

  it("classifies common source errors deterministically", () => {
    expect(classifySourceFailure(new Error("HTTP 404"))).toBe("slug_gone");
    expect(classifySourceFailure(new Error("HTTP 429"))).toBe("rate_limited");
    expect(classifySourceFailure(new Error("request aborted"))).toBe("timeout");
    expect(classifySourceFailure(new Error("expected a jobs array"))).toBe(
      "invalid_payload",
    );
    expect(classifySourceFailure(new Error("ECONNRESET"))).toBe("network");
    expect(classifySourceFailure(new Error("getaddrinfo ENOTFOUND"))).toBe(
      "network",
    );
    expect(classifySourceFailure(new Error("board not found"))).toBe(
      "network",
    );
  });

  it("falls back from non-finite policy thresholds", () => {
    const health = computeSourceHealth(
      [
        observation("network", 1),
        observation("network", 2),
        observation("network", 3),
      ],
      { degradedAfter: Number.NaN, unhealthyAfter: Number.POSITIVE_INFINITY },
    );

    expect(health).toMatchObject({
      status: "unhealthy",
      consecutiveFailures: 3,
    });
  });
});
