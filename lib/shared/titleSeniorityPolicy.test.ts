import { describe, expect, it } from "vitest";

import corpus from "@/test/titleSeniorityPolicy.corpus.json";
import {
  evaluateLegacyTitleExclusions,
  evaluateTitleSeniorityForPolicy,
} from "./titleSeniorityPolicy";

type CorpusCase = {
  name: string;
  title: string;
  expectedOutcome: "KEEP" | "EXCLUDE";
  expectedRuleId: string;
};

type LegacyCorpusCase = CorpusCase & { configuredTerms: string[] };

const cases = corpus.cases as CorpusCase[];
const legacyCases = corpus.legacyCases as LegacyCorpusCase[];

describe("title seniority policy shared contract", () => {
  it("contains high-confidence and fail-open examples", () => {
    expect(cases.length).toBeGreaterThan(20);
  });

  for (const testCase of cases) {
    it(testCase.name, () => {
      const decision = evaluateTitleSeniorityForPolicy(
        testCase.title,
        corpus.policyId,
      );

      expect({ outcome: decision.outcome, ruleId: decision.ruleId }).toEqual({
        outcome: testCase.expectedOutcome,
        ruleId: testCase.expectedRuleId,
      });
      if (decision.outcome === "EXCLUDE") {
        expect(decision.evidence).not.toBe("");
      }
    });
  }
});

describe("title seniority policy v1 compatibility", () => {
  for (const testCase of legacyCases) {
    it(testCase.name, () => {
      const decision = evaluateLegacyTitleExclusions(
        testCase.title,
        testCase.configuredTerms,
      );
      expect({ outcome: decision.outcome, ruleId: decision.ruleId }).toEqual({
        outcome: testCase.expectedOutcome,
        ruleId: testCase.expectedRuleId,
      });
    });
  }
});
