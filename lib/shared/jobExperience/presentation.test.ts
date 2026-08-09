import { describe, expect, it } from "vitest";

import type {
  JobExperienceAnalysis,
  JobExperienceRequirement,
} from "./analyzer";
import { projectVisibleJobExperience } from "./presentation";

function requirement(
  description: string,
  text: string,
  patch: Partial<JobExperienceRequirement> = {},
): JobExperienceRequirement {
  const yearsStart = description.indexOf(text);
  return {
    id: `experience-${yearsStart}-${yearsStart + text.length}`,
    classification: "REQUIRED",
    years: { operator: "AT_LEAST", min: 3, max: null, text },
    scope: "backend engineering",
    evidence: {
      text: description,
      start: 0,
      end: description.length,
      yearsStart,
      yearsEnd: yearsStart + text.length,
    },
    ...patch,
  };
}

function analysis(
  requirements: JobExperienceRequirement[],
): JobExperienceAnalysis {
  return { schemaVersion: 3, status: "FOUND", requirements };
}

describe("projectVisibleJobExperience", () => {
  it("keeps only source-verifiable REQUIRED quantities", () => {
    const description = "Requirements: 3+ years backend. 2 years AWS preferred.";
    const required = requirement(description, "3+ years");
    const preferred = requirement(description, "2 years", {
      classification: "PREFERRED",
      id: "preferred",
    });

    const projected = projectVisibleJobExperience(
      description,
      analysis([required, preferred]),
    );

    expect(projected.requirements).toEqual([required]);
    expect(projected.highlights).toEqual([
      {
        requirementId: required.id,
        start: description.indexOf("3+ years"),
        end: description.indexOf("3+ years") + "3+ years".length,
        text: "3+ years",
      },
    ]);
  });

  it("fails closed when the source offsets no longer match the JD", () => {
    const description = "Requirements: 3+ years backend.";
    const stale = requirement(description, "3+ years", {
      evidence: {
        text: description,
        start: 0,
        end: description.length,
        yearsStart: 0,
        yearsEnd: "3+ years".length,
      },
    });

    expect(
      projectVisibleJobExperience(description, analysis([stale])),
    ).toEqual({ requirements: [], highlights: [] });
  });

  it("removes a relation when a hidden member would make it incomplete", () => {
    const description = "Requirements: 5 years total or 3 years preferred.";
    const relation = { groupId: "group-1", kind: "ANY_OF" as const };
    const total = requirement(description, "5 years", { relation });
    const alternative = requirement(description, "3 years", {
      id: "preferred",
      classification: "PREFERRED",
      relation,
    });

    const projected = projectVisibleJobExperience(
      description,
      analysis([total, alternative]),
    );

    expect(projected.requirements).toHaveLength(1);
    expect(projected.requirements[0]).not.toHaveProperty("relation");
  });

  it("preserves a complete REQUIRED relation", () => {
    const description = "Requirements: 5 years total including 2 years cloud.";
    const totalRelation = {
      groupId: "group-1",
      kind: "ALL_OF" as const,
      role: "TOTAL" as const,
    };
    const subsetRelation = {
      groupId: "group-1",
      kind: "ALL_OF" as const,
      role: "SUBSET" as const,
    };
    const total = requirement(description, "5 years", {
      relation: totalRelation,
    });
    const subset = requirement(description, "2 years", {
      id: "subset",
      relation: subsetRelation,
    });

    const projected = projectVisibleJobExperience(
      description,
      analysis([total, subset]),
    );

    expect(projected.requirements.map((item) => item.relation)).toEqual([
      totalRelation,
      subsetRelation,
    ]);
  });
});
