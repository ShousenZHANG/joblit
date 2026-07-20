import { describe, expect, it } from "vitest";
import {
  buildInterviewQuestions,
  buildNegotiationScript,
  mapStarStoriesToRequirements,
} from "@/lib/server/career/toolkit";

describe("grounded career toolkit", () => {
  it("generates one evidence-seeking interview question per requirement", () => {
    const questions = buildInterviewQuestions(
      ["Build production services with TypeScript", "Operate AWS workloads"],
      "en",
    );
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({
      requirement: "Build production services with TypeScript",
      evidenceRequired: true,
    });
    expect(questions[0].question).toContain("TypeScript");
    expect(questions[0].followUps.join(" ")).toContain("measured");
  });

  it("maps only stories with observable lexical evidence", () => {
    const mappings = mapStarStoriesToRequirements(
      ["Kubernetes production operations", "Chinese stakeholder communication"],
      [
        {
          id: "story-k8s",
          title: "Production platform migration",
          skills: ["Kubernetes", "AWS"],
          tags: ["operations"],
        },
      ],
    );
    expect(mappings[0].candidates[0].storyId).toBe("story-k8s");
    expect(mappings[0].needsEvidence).toBe(false);
    expect(mappings[1]).toMatchObject({ candidates: [], needsEvidence: true });
  });

  it("matches Chinese requirements using character bigrams", () => {
    const mappings = mapStarStoriesToRequirements(
      ["需要跨部门沟通和项目交付能力"],
      [
        {
          id: "story-zh",
          title: "跨部门项目交付",
          skills: ["利益相关方沟通"],
          tags: [],
        },
      ],
    );
    expect(mappings[0].candidates[0].storyId).toBe("story-zh");
    expect(mappings[0].needsEvidence).toBe(false);
  });

  it("uses supplied offer facts without inventing strengths", () => {
    const result = buildNegotiationScript({
      company: "Example Co",
      role: "Platform Engineer",
      currency: "AUD",
      offeredTotal: 160_000,
      targetTotal: 175_000,
      strengths: ["Led a verified Kubernetes migration"],
      locale: "en",
    });
    expect(result.script).toContain("Example Co");
    expect(result.script).toContain("$160,000");
    expect(result.script).toContain("$175,000");
    expect(result.script).toContain("Led a verified Kubernetes migration");
    expect(result.inventedFacts).toEqual([]);
  });

  it("states missing evidence instead of fabricating it", () => {
    const result = buildNegotiationScript({
      company: "Example Co",
      role: "Engineer",
      currency: "AUD",
      strengths: [],
      locale: "en",
    });
    expect(result.script).toContain("none was invented");
    expect(result.factsUsed.strengths).toEqual([]);
    expect(result.inventedFacts).toEqual([]);
  });
});
