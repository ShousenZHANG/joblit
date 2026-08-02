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
type PolicyCorpusCase = CorpusCase & { policyId: string };

const cases = corpus.cases as CorpusCase[];
const legacyCases = corpus.legacyCases as LegacyCorpusCase[];
const policyCases = corpus.policyCases as PolicyCorpusCase[];
const AU_RECALL_SAFE_V2_POLICY_ID = "au-recall-safe-v2";

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

describe("title seniority policy v2", () => {
  for (const testCase of policyCases) {
    it(testCase.name, () => {
      const decision = evaluateTitleSeniorityForPolicy(
        testCase.title,
        testCase.policyId,
      );
      expect({ outcome: decision.outcome, ruleId: decision.ruleId }).toEqual({
        outcome: testCase.expectedOutcome,
        ruleId: testCase.expectedRuleId,
      });
    });
  }

  it("keeps explicit Senior roles while preserving every other hard exclusion", () => {
    for (const testCase of cases) {
      const decision = evaluateTitleSeniorityForPolicy(
        testCase.title,
        AU_RECALL_SAFE_V2_POLICY_ID,
      );

      if (testCase.expectedRuleId === "TITLE_SENIOR") {
        expect(decision.outcome, testCase.name).toBe("KEEP");
        continue;
      }
      if (testCase.expectedOutcome === "EXCLUDE") {
        expect(
          { outcome: decision.outcome, ruleId: decision.ruleId },
          testCase.name,
        ).toEqual({
          outcome: "EXCLUDE",
          ruleId: testCase.expectedRuleId,
        });
      } else {
        expect(decision.outcome, testCase.name).toBe("KEEP");
      }
    }
  });
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
