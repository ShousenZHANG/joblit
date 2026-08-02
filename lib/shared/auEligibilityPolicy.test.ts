import { describe, expect, it } from "vitest";

import corpus from "@/test/auEligibilityPolicy.corpus.json";
import {
  AU_ELIGIBILITY_POLICY_VERSION,
  evaluateAuEligibility,
} from "./auEligibilityPolicy";

type CorpusCase = (typeof corpus.cases)[number];

function evaluate(item: CorpusCase) {
  const active = new Set<string>(item.rules);
  return evaluateAuEligibility(item.description, {
    identityRequirement: active.has("identity_requirement"),
    clearanceRequirement: active.has("clearance_requirement"),
  });
}

describe("AU eligibility policy A shared corpus", () => {
  it("uses the corpus policy version", () => {
    expect(AU_ELIGIBILITY_POLICY_VERSION).toBe(corpus.policyVersion);
  });

  for (const item of corpus.cases) {
    it(item.name, () => {
      const decision = evaluate(item);
      expect({
        verdict: decision.verdict,
        reasonCode: decision.reasonCode ?? null,
        evidence: decision.evidence?.clause ?? null,
      }).toEqual(item.expected);

      if (decision.evidence && item.description) {
        expect(
          item.description.slice(decision.evidence.start, decision.evidence.end),
        ).toBe(decision.evidence.clause);
      }
    });
  }

  it("is invariant when unrelated sentences are appended", () => {
    const base = evaluateAuEligibility("Must be an Australian citizen.");
    const withNoise = evaluateAuEligibility(
      "Must be an Australian citizen. A degree is not required. Sponsorship is available for other roles.",
    );
    expect(withNoise.verdict).toBe(base.verdict);
    expect(withNoise.reasonCode).toBe(base.reasonCode);
    expect(withNoise.evidence?.clause).toBe(base.evidence?.clause);
  });

  it("turns a preferred signal into KEEP", () => {
    expect(evaluateAuEligibility("NV1 clearance is required.").verdict).toBe(
      "EXCLUDE",
    );
    expect(evaluateAuEligibility("NV1 clearance is preferred.").verdict).toBe(
      "KEEP",
    );
  });

  it("reports UTF-16 evidence offsets across astral characters", () => {
    const decision = evaluateAuEligibility(
      "About 🚀. Must be an Australian citizen.",
    );
    expect(decision.evidence).toMatchObject({ start: 10, end: 39 });
  });
});
