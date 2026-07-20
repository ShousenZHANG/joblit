import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_MIN_ELIGIBILITY_AGREEMENT,
  evaluateGoldenSet,
  formatGoldenReport,
  type GoldenCase,
} from "@/lib/server/ai/fitGolden";
import { FitMatrixSchema, type FitMatrix } from "@/lib/shared/schemas/fitMatrix";

// CI gate for the fit pipeline. Replays recorded model output against a frozen
// reference set — no network, no API key, no cost, fully deterministic.
//
// To evaluate a new model: record its matrix per case into
// test/fixtures/fitGolden/replays.<model>.json and add it to MODELS below.

const FIXTURES = path.join(process.cwd(), "test", "fixtures", "fitGolden");

function loadCases(): GoldenCase[] {
  return JSON.parse(
    readFileSync(path.join(FIXTURES, "cases.json"), "utf8"),
  ) as GoldenCase[];
}

function loadReplays(model: string): Record<string, FitMatrix> {
  return JSON.parse(
    readFileSync(path.join(FIXTURES, `replays.${model}.json`), "utf8"),
  ) as Record<string, FitMatrix>;
}

const MODELS = ["cheap-stub"];

describe("fit golden set", () => {
  const cases = loadCases();

  it("keeps the reference set large enough to be worth gating on", () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  it("has unique case ids", () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it("stores only schema-valid reference matrices", () => {
    for (const goldenCase of cases) {
      const parsed = FitMatrixSchema.safeParse(goldenCase.reference);
      expect(parsed.success, `${goldenCase.id}: ${parsed.error?.message}`).toBe(
        true,
      );
    }
  });

  it("covers every eligibility status, so the gate has real range", () => {
    const statuses = new Set(cases.map((c) => c.reference.eligibility.status));
    expect(statuses).toEqual(new Set(["PASS", "RISK", "BLOCK"]));
  });

  it("includes GATE-criticality cases, which drive the deterministic caps", () => {
    const gated = cases.filter((c) =>
      c.reference.requirements.some((r) => r.criticality === "GATE"),
    );
    expect(gated.length).toBeGreaterThanOrEqual(2);
  });

  it.each(MODELS)("%s meets the eligibility agreement gate", (model) => {
    const report = evaluateGoldenSet({
      cases,
      replays: loadReplays(model),
    });

    // Surfaced on failure so CI output names the drift instead of just a count.
    const detail = [
      formatGoldenReport(model, report),
      ...report.disagreements.map(
        (d) => `  ${d.id} ${d.field}: expected ${d.expected}, got ${d.actual}`,
      ),
    ].join("\n");

    expect(report.missingReplays, detail).toEqual([]);
    expect(
      report.eligibilityAgreement,
      detail,
    ).toBeGreaterThanOrEqual(DEFAULT_MIN_ELIGIBILITY_AGREEMENT);
    expect(report.passed, detail).toBe(true);
  });

  it("the recorded stub is not a trivial pass", () => {
    // A replay that agreed on everything would make the gate meaningless: it
    // would stay green no matter how the pipeline changed. The recorded stub
    // deliberately diverges the way a cheaper model does — rounding UNKNOWN and
    // PARTIAL up to MATCH, and missing a soft eligibility RISK.
    const report = evaluateGoldenSet({
      cases,
      replays: loadReplays("cheap-stub"),
    });

    expect(report.disagreements.length).toBeGreaterThan(0);
    expect(report.scoreAgreement).toBeLessThan(1);
  });
});
