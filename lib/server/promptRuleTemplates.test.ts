import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/prisma", () => ({ prisma: {} }));

import {
  DEFAULT_COVER_RULES,
  DEFAULT_CV_RULES,
} from "@/lib/shared/aiPromptDefaults";
import {
  sanitizePromptCoverRules,
  sanitizePromptCvRules,
  sanitizePromptHardConstraints,
} from "./promptRuleTemplates";

describe("prompt rule template contract filtering", () => {
  it("removes persisted legacy output-contract rules while preserving semantic rules", () => {
    expect(
      sanitizePromptCvRules([
        "Keep every statement grounded in the Master Resume Profile.",
        "Return latestExperience.bullets as the COMPLETE final bullet list.",
        "Reorder latest experience bullets to mirror the JD.",
        "Return skillsFinal as the COMPLETE final skills list.",
        "Do not return skillsAdditions; return skillsFinal only.",
        "Flag irrelevant base bullets in output comments but still include them to preserve verbatim.",
        "Bold 3-5 JD-aligned keywords in cvSummary.",
      ]),
    ).toEqual([
      "Keep every statement grounded in the Master Resume Profile.",
      "Bold 3-5 JD-aligned keywords in cvSummary.",
    ]);
  });

  it("removes stored rules that still ask for generated experience text", () => {
    expect(
      sanitizePromptCvRules([
        "Return latestExperience.addedBullets as additions only.",
        "Keep added bullets under 200 characters.",
        "Start each added bullet with a strong action verb.",
        "Order skillsSelection by relevance to the posting.",
      ]),
    ).toEqual(["Order skillsSelection by relevance to the posting."]);
  });

  it("falls back to current definitions when every stored CV rule is retired", () => {
    expect(
      sanitizePromptCvRules([
        "Return skillsFinal as the complete list.",
        "Reorder latestExperience.bullets.",
      ]),
    ).toEqual(DEFAULT_CV_RULES);
  });

  it("removes retired cover fields without dropping paragraph guidance", () => {
    expect(
      sanitizePromptCoverRules([
        "Include candidateTitle, subject, date, salutation, closing, and signatureName.",
        "Subject should be concise and role-focused.",
        "Salutation should contain addressee text only.",
        "The final sentence should include a professional call to action.",
      ]),
    ).toEqual([
      "The final sentence should include a professional call to action.",
    ]);
  });

  it("prevents retired output fields from hiding in hard constraints", () => {
    expect(
      sanitizePromptHardConstraints([
        "Return JSON only.",
        "The output must include skillsFinal.",
        "Include candidateTitle and signatureName.",
      ]),
    ).toEqual(["Return JSON only."]);
  });

  it("keeps current defaults free of retired contract vocabulary", () => {
    expect(DEFAULT_CV_RULES.join("\n")).not.toMatch(
      /skillsFinal|skillsAdditions|latestExperience|addedBullets|bullets?\b|reorder/i,
    );
    expect(DEFAULT_CV_RULES.join("\n")).toContain("skillsSelection");
    expect(DEFAULT_COVER_RULES.join("\n")).not.toMatch(
      /candidateTitle|signatureName|subject should|salutation should/i,
    );
  });

  // A default that its own sanitizer strips would silently swap the whole
  // active template for the fallback list, which is the same list.
  it("survives its own retired-rule filter", () => {
    expect(sanitizePromptCvRules(DEFAULT_CV_RULES)).toEqual(DEFAULT_CV_RULES);
    expect(sanitizePromptCoverRules(DEFAULT_COVER_RULES)).toEqual(
      DEFAULT_COVER_RULES,
    );
  });
});
