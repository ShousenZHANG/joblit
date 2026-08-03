import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  jobDetailResponseSchema,
  jobListItemSchema,
  jobsListResponseSchema,
} from "./jobsList";
import { analyzeJobExperience } from "../jobExperienceAnalysis";
import {
  LegacyJobExperienceAnalysisSchema,
  projectJobExperienceAnalysisV1,
} from "../jobExperienceAnalysisCompat";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    jobUrl: "https://example.com/jobs/1",
    title: "Platform Engineer",
    company: "Globex",
    location: "Sydney",
    jobType: null,
    jobLevel: null,
    status: "NEW",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("jobsListResponseSchema", () => {
  it("accepts a minimal row", () => {
    expect(jobListItemSchema.safeParse(row()).success).toBe(true);
  });

  it("accepts every retired status the database can still hold", () => {
    // ADR-0007 keeps all seven parseable; only three are offered.
    for (const status of ["INTERVIEW", "OFFER", "ACCEPTED", "WITHDRAWN"]) {
      expect(jobListItemSchema.safeParse(row({ status })).success).toBe(true);
    }
  });

  it("rejects a row with no id rather than rendering a card that cannot be opened", () => {
    const { id: _id, ...withoutId } = row();
    expect(jobListItemSchema.safeParse(withoutId).success).toBe(false);
  });

  it("rejects a status the projection does not know", () => {
    expect(
      jobListItemSchema.safeParse(row({ status: "ARCHIVED" })).success,
    ).toBe(false);
  });

  it("rejects a numeric field arriving as a string", () => {
    expect(jobListItemSchema.safeParse(row({ fitScore: "72" })).success).toBe(
      false,
    );
  });

  it("strips unknown keys so a new server field does not break an old client", () => {
    const parsed = jobListItemSchema.parse(row({ somethingNew: "value" }));
    expect(parsed).not.toHaveProperty("somethingNew");
  });

  it("requires items and a cursor slot on the envelope", () => {
    expect(
      jobsListResponseSchema.safeParse({ items: [row()], nextCursor: null })
        .success,
    ).toBe(true);
    expect(jobsListResponseSchema.safeParse({ items: [row()] }).success).toBe(
      false,
    );
  });

  it("rejects an envelope whose items are not rows", () => {
    expect(
      jobsListResponseSchema.safeParse({
        items: [{ nope: true }],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });

  it("carries the optional facets and total through", () => {
    const parsed = jobsListResponseSchema.parse({
      items: [],
      nextCursor: "cursor-1",
      totalCount: 42,
      facets: { jobLevels: ["Mid", "Senior"] },
    });
    expect(parsed.totalCount).toBe(42);
    expect(parsed.facets?.jobLevels).toEqual(["Mid", "Senior"]);
  });
});

describe("jobDetailResponseSchema", () => {
  it("accepts a detail with no fit matrix yet", () => {
    const parsed = jobDetailResponseSchema.safeParse({
      id: "job-1",
      description: "Build things.",
      fitMatrix: null,
      updatedAt: "2026-07-01T00:00:00.000Z",
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.experienceAnalysis).toEqual({
      schemaVersion: 2,
      status: "NONE",
      requirements: [],
    });
  });

  it("upgrades an old-server v1-only response to the unified v2 client contract", () => {
    const description = "At least 3 years of backend experience.";
    const parsed = jobDetailResponseSchema.parse({
      id: "job-1",
      description,
      fitMatrix: null,
      experienceAnalysis: {
        schemaVersion: 1,
        status: "FOUND",
        requirements: [experienceRequirement(description, "3 years", 3)],
      },
      updatedAt: "2026-07-01T00:00:00.000Z",
    });

    expect(parsed.experienceAnalysis).toMatchObject({
      schemaVersion: 2,
      status: "FOUND",
      requirements: [{ classification: "REQUIRED", years: { min: 3 } }],
    });
    expect(parsed).not.toHaveProperty("experienceAnalysisV2");
  });

  it("prefers the v2 member of a dual response without exposing the transport field", () => {
    const description = "3.5+ years of platform experience.";
    const v2Requirement = {
      ...experienceRequirement(description, "3.5+ years", 3.5),
      classification: "STATED" as const,
    };
    const parsed = jobDetailResponseSchema.parse({
      id: "job-1",
      description,
      fitMatrix: null,
      experienceAnalysis: {
        schemaVersion: 1,
        status: "NONE",
        requirements: [],
      },
      experienceAnalysisV2: {
        schemaVersion: 2,
        status: "FOUND",
        requirements: [v2Requirement],
      },
      updatedAt: "2026-07-01T00:00:00.000Z",
    });

    expect(parsed.experienceAnalysis.requirements[0]).toMatchObject({
      classification: "STATED",
      years: { min: 3.5 },
    });
    expect(parsed).not.toHaveProperty("experienceAnalysisV2");
  });

  it("rejects malformed experience evidence at the detail seam", () => {
    expect(
      jobDetailResponseSchema.safeParse({
        id: "job-1",
        description: "Minimum 3 years of experience.",
        fitMatrix: null,
        experienceAnalysis: {
          schemaVersion: 1,
          status: "FOUND",
          requirements: [{ id: "missing-required-fields" }],
        },
        updatedAt: "2026-07-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("rejects well-shaped evidence that does not match the JD source", () => {
    const description = "Minimum 3 years of backend experience is required.";
    const experienceAnalysis = analyzeJobExperience(description);
    const requirement = experienceAnalysis.requirements[0];
    expect(requirement).toBeDefined();
    const legacyExperienceAnalysis =
      projectJobExperienceAnalysisV1(experienceAnalysis);

    expect(
      jobDetailResponseSchema.safeParse({
        id: "job-1",
        description: description.replace("backend", "systems"),
        fitMatrix: null,
        experienceAnalysis: legacyExperienceAnalysis,
        experienceAnalysisV2: experienceAnalysis,
        updatedAt: "2026-07-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("requires updatedAt — the list and detail use it to stay coherent", () => {
    expect(
      jobDetailResponseSchema.safeParse({
        id: "job-1",
        description: null,
        fitMatrix: null,
      }).success,
    ).toBe(false);
  });
});

describe("experience analysis expand/contract compatibility", () => {
  it("projects v2 to a v1 payload an old client can parse", () => {
    const description =
      "5 years of engineering experience, including 2 years of Java.";
    const total = experienceRequirement(description, "5 years", 5, {
      id: "total",
      scope: "engineering",
      relation: { groupId: "g-1", kind: "ALL_OF", role: "TOTAL" },
    });
    const subset = experienceRequirement(description, "2 years", 2, {
      id: "subset",
      scope: "Java",
      classification: "STATED",
      relation: { groupId: "g-1", kind: "ALL_OF", role: "SUBSET" },
    });

    const legacy = projectJobExperienceAnalysisV1({
      schemaVersion: 2,
      status: "FOUND",
      requirements: [total, subset],
    });

    expect(LegacyJobExperienceAnalysisSchema.safeParse(legacy).success).toBe(
      true,
    );
    expect(legacy).toMatchObject({
      schemaVersion: 1,
      status: "REVIEW",
      requirements: [
        { id: "total", classification: "REQUIRED" },
        { id: "subset", classification: "REVIEW" },
      ],
    });
    expect(legacy.requirements[0]?.relation).toEqual({
      groupId: "g-1",
      kind: "ALL_OF",
    });
    expect(legacy.requirements[1]?.relation).toEqual({
      groupId: "g-1",
      kind: "ALL_OF",
    });
  });

  it("drops fractional requirements instead of rounding and removes orphan relations", () => {
    const description = "2 years of backend and 18 months of Java experience.";
    const integerRequirement = experienceRequirement(
      description,
      "2 years",
      2,
      {
        id: "integer",
        relation: { groupId: "g-2", kind: "ALL_OF", role: "TOTAL" },
      },
    );
    const fractionalRequirement = experienceRequirement(
      description,
      "18 months",
      1.5,
      {
        id: "fractional",
        relation: { groupId: "g-2", kind: "ALL_OF", role: "SUBSET" },
      },
    );

    const legacy = projectJobExperienceAnalysisV1({
      schemaVersion: 2,
      status: "FOUND",
      requirements: [integerRequirement, fractionalRequirement],
    });

    expect(legacy.requirements).toHaveLength(1);
    expect(legacy.requirements[0]).toMatchObject({
      id: "integer",
      years: { min: 2 },
    });
    expect(legacy.requirements[0]).not.toHaveProperty("relation");
    expect(JSON.stringify(legacy)).not.toContain("1.5");
  });

  it("keeps the dual response parseable by an old non-strict client", () => {
    const description = "At least 3 years of backend experience.";
    const v2 = {
      schemaVersion: 2 as const,
      status: "FOUND" as const,
      requirements: [experienceRequirement(description, "3 years", 3)],
    };
    const oldClientDetailSchema = z.object({
      experienceAnalysis: LegacyJobExperienceAnalysisSchema,
    });

    const parsed = oldClientDetailSchema.parse({
      experienceAnalysis: projectJobExperienceAnalysisV1(v2),
      experienceAnalysisV2: v2,
    });

    expect(parsed.experienceAnalysis.schemaVersion).toBe(1);
    expect(parsed).not.toHaveProperty("experienceAnalysisV2");
  });
});

function experienceRequirement(
  description: string,
  yearsText: string,
  years: number,
  overrides: Record<string, unknown> = {},
) {
  const yearsStart = description.indexOf(yearsText);
  return {
    id: `req-${yearsStart}`,
    classification: "REQUIRED" as const,
    years: {
      operator: "MINIMUM" as const,
      min: years,
      max: null,
      text: yearsText,
    },
    scope: "backend",
    evidence: {
      text: description,
      start: 0,
      end: description.length,
      yearsStart,
      yearsEnd: yearsStart + yearsText.length,
    },
    ...overrides,
  };
}
