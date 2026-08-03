import { describe, expect, it } from "vitest";

import {
  EMPTY_JOB_EXPERIENCE_ANALYSIS,
  JobExperienceAnalysisSchema,
  analyzeJobExperience,
} from "./jobExperienceAnalysis";

describe("analyzeJobExperience", () => {
  it("identifies the deterministic experience contract as schema v2", () => {
    const analysis = analyzeJobExperience("3 years of backend experience");

    expect(analysis.schemaVersion).toBe(2);
    expect(
      JobExperienceAnalysisSchema.safeParse({ ...analysis, schemaVersion: 1 })
        .success,
    ).toBe(false);
  });

  it("recognizes a combined Required Skills & Experience heading", () => {
    const description =
      "Required Skills & Experience:\n- 5+ years of backend development experience with Java.";

    const requirement = analyzeJobExperience(description).requirements[0];

    expect(requirement).toMatchObject({
      classification: "REQUIRED",
      years: { operator: "MINIMUM", min: 5, max: null, text: "5+ years" },
      scope: "backend development",
    });
    expect(
      description.slice(
        requirement?.evidence.yearsStart,
        requirement?.evidence.yearsEnd,
      ),
    ).toBe("5+ years");
  });

  it.each([
    "Required Skills & Qualifications",
    "Required Experience and Skills",
    "Key Requirements",
    "Job Requirements",
    "Your Skills and Experience",
  ])("keeps common combined requirement headings required: %s", (heading) => {
    expect(
      analyzeJobExperience(
        `${heading}:\n- 4 years of platform engineering experience.`,
      ).requirements[0]?.classification,
    ).toBe("REQUIRED");
  });

  it("keeps a combined preferred heading preferred", () => {
    expect(
      analyzeJobExperience(
        "Preferred Skills & Experience:\n- 2 years of React experience.",
      ).requirements[0]?.classification,
    ).toBe("PREFERRED");
  });

  it("classifies an unqualified candidate-experience statement as STATED", () => {
    const description = "5+ years of backend development experience with Java.";

    expect(analyzeJobExperience(description)).toMatchObject({
      status: "FOUND",
      requirements: [
        {
          classification: "STATED",
          years: { operator: "MINIMUM", min: 5, max: null },
          scope: "backend development",
        },
      ],
    });
  });

  it("classifies education-or-equivalent-experience as ALTERNATIVE", () => {
    const description =
      "Requirements: Bachelor's degree or 4 years of equivalent professional experience.";

    const requirement = analyzeJobExperience(description).requirements[0];

    expect(requirement).toMatchObject({
      classification: "ALTERNATIVE",
      years: { operator: "EXACT", min: 4, max: 4, text: "4 years" },
      scope: "equivalent professional",
    });
    expect(
      description.slice(
        requirement?.evidence.yearsStart,
        requirement?.evidence.yearsEnd,
      ),
    ).toBe("4 years");
  });

  it("recognizes experience accepted in lieu of education as ALTERNATIVE", () => {
    expect(
      analyzeJobExperience(
        "4 years of equivalent professional experience may be accepted in lieu of a bachelor's degree.",
      ).requirements[0]?.classification,
    ).toBe("ALTERNATIVE");
  });

  it("normalizes a quantifiable month duration without changing its evidence", () => {
    const description =
      "18 months of backend development experience is required.";

    const requirement = analyzeJobExperience(description).requirements[0];

    expect(requirement).toMatchObject({
      classification: "REQUIRED",
      years: { operator: "EXACT", min: 1.5, max: 1.5, text: "18 months" },
      scope: "backend development",
    });
    expect(
      description.slice(
        requirement?.evidence.yearsStart,
        requirement?.evidence.yearsEnd,
      ),
    ).toBe("18 months");
  });

  it("supports a decimal minimum in years", () => {
    const description =
      "3.5+ years of platform engineering experience required.";

    const requirement = analyzeJobExperience(description).requirements[0];

    expect(requirement).toMatchObject({
      classification: "REQUIRED",
      years: { operator: "MINIMUM", min: 3.5, max: null, text: "3.5+ years" },
      scope: "platform engineering",
    });
    expect(
      description.slice(
        requirement?.evidence.yearsStart,
        requirement?.evidence.yearsEnd,
      ),
    ).toBe("3.5+ years");
  });

  it("does not reinterpret an ambiguous plus-suffixed range as its upper bound", () => {
    expect(
      analyzeJobExperience("2-4+ years of backend experience").requirements[0],
    ).toMatchObject({
      classification: "REVIEW",
      years: {
        operator: "RANGE",
        min: 2,
        max: 4,
        text: "2-4+ years",
      },
    });
  });

  it("keeps the minimum operator for a parenthetical number", () => {
    const description =
      "At least five (5) years of data engineering experience is required.";

    expect(analyzeJobExperience(description).requirements[0]).toMatchObject({
      classification: "REQUIRED",
      years: {
        operator: "MINIMUM",
        min: 5,
        max: null,
        text: "At least five (5) years",
      },
      scope: "data engineering",
    });
  });

  it.each([
    [
      ">= 4 years of cloud experience required",
      "MINIMUM",
      4,
      null,
      ">= 4 years",
    ],
    ["≤ 2 years of experience is preferred", "MAXIMUM", 0, 2, "≤ 2 years"],
  ] as const)(
    "supports a symbolic year bound: %s",
    (description, operator, min, max, text) => {
      expect(analyzeJobExperience(description).requirements[0]).toMatchObject({
        years: { operator, min, max, text },
      });
    },
  );

  it("resets inherited classification at an unknown section heading", () => {
    const description = [
      "Requirements:",
      "- 3 years of backend experience.",
      "Team principles:",
      "- 2 years of pair-programming experience informs our approach.",
    ].join("\n");

    expect(
      analyzeJobExperience(description).requirements.map(
        ({ classification, years }) => ({ classification, min: years.min }),
      ),
    ).toEqual([
      { classification: "REQUIRED", min: 3 },
      { classification: "STATED", min: 2 },
    ]);
  });

  it("resets inherited classification at any HTML heading", () => {
    const description =
      "<h3>Requirements</h3><p>3 years of backend experience.</p>" +
      "<h3>Team principles</h3><p>2 years of pair-programming experience informs our approach.</p>";

    expect(
      analyzeJobExperience(description).requirements.map(
        ({ classification, years }) => ({ classification, min: years.min }),
      ),
    ).toEqual([
      { classification: "REQUIRED", min: 3 },
      { classification: "STATED", min: 2 },
    ]);
  });

  it("resets inherited classification at any Markdown heading", () => {
    const description = [
      "## Requirements",
      "- 3 years of backend experience.",
      "## Team principles",
      "- 2 years of pair-programming experience informs our approach.",
    ].join("\n");

    expect(
      analyzeJobExperience(description).requirements.map(
        ({ classification, years }) => ({ classification, min: years.min }),
      ),
    ).toEqual([
      { classification: "REQUIRED", min: 3 },
      { classification: "STATED", min: 2 },
    ]);
  });

  it("recognizes multiple headings inside a flattened single-line JD", () => {
    const description =
      "Overview: We build software. About you: 5+ years of backend experience. Preferred Qualifications: 2 years of React experience.";

    expect(
      analyzeJobExperience(description).requirements.map(
        ({ classification, years, scope }) => ({
          classification,
          min: years.min,
          scope,
        }),
      ),
    ).toEqual([
      { classification: "REQUIRED", min: 5, scope: "backend" },
      { classification: "PREFERRED", min: 2, scope: "React" },
    ]);
  });

  it.each([
    "Requirements:\n- You must be available for the next 3 years.",
    "Requirements:\n- Complete a 2-year rotation.",
    "Requirements:\n- Deliver the project over 5 years.",
    "Requirements:\n- Applicants must have lived in Australia for 5 years.",
    "Requirements:\n- The initiative is funded for 4 years.",
    "Requirements:\n- Keep records for 7 years.",
    "Requirements:\n- Our company has operated for 25 years.",
    "Requirements:\n- Candidates must be able to work for the next 3 years.",
  ])(
    "rejects a non-candidate duration even under a required heading: %s",
    (description) => {
      expect(analyzeJobExperience(description).requirements).toEqual([]);
    },
  );

  it.each([
    "About us:\n- Our team brings 20+ years of combined software experience.",
    "Our product roadmap spans 5 years with investments in Java.",
    "You need 3 years of availability for this assignment.",
  ])(
    "does not promote an organisational horizon to candidate experience: %s",
    (description) => {
      expect(analyzeJobExperience(description).requirements).toEqual([]);
    },
  );

  it.each([
    "Requirements:\n- This is a 3-year contract.",
    "Requirements:\n- The project requires 3 years.",
    "Requirements:\n- Deliver a 5-year roadmap.",
    "Requirements:\n- The business has a 5-year funding runway.",
  ])("keeps a hyphenated non-experience horizon hidden: %s", (description) => {
    expect(analyzeJobExperience(description).requirements).toEqual([]);
  });

  it.each([
    [
      "5+ years of experience within building services consulting",
      "building services consulting",
    ],
    [
      "4 years of experience across enterprise platforms",
      "enterprise platforms",
    ],
    ["3 years as a software engineer", "software engineer"],
    ["2 years working in data engineering", "data engineering"],
  ] as const)(
    "normalizes an experience scope without grammar leakage: %s",
    (description, scope) => {
      expect(analyzeJobExperience(description).requirements[0]?.scope).toBe(
        scope,
      );
    },
  );

  it("models an overall requirement with an included subset", () => {
    const analysis = analyzeJobExperience(
      "Requirements:\n- 5+ years of engineering experience overall, including 2+ years of Java experience.",
    );

    expect(
      analysis.requirements.map(({ years, scope, relation }) => ({
        min: years.min,
        scope,
        kind: relation?.kind,
        role: relation?.role,
        groupId: relation?.groupId,
      })),
    ).toEqual([
      {
        min: 5,
        scope: "engineering",
        kind: "ALL_OF",
        role: "TOTAL",
        groupId: expect.any(String),
      },
      {
        min: 2,
        scope: "Java",
        kind: "ALL_OF",
        role: "SUBSET",
        groupId: expect.any(String),
      },
    ]);
    expect(analysis.requirements[0]?.relation?.groupId).toBe(
      analysis.requirements[1]?.relation?.groupId,
    );
  });

  it("models multiple included subsets under one overall requirement", () => {
    const analysis = analyzeJobExperience(
      "Requirements:\n- 5+ years of engineering experience overall, including 2+ years Java and 1+ year AWS experience.",
    );

    expect(
      analysis.requirements.map(({ years, scope, relation }) => ({
        min: years.min,
        scope,
        kind: relation?.kind,
        role: relation?.role,
      })),
    ).toEqual([
      { min: 5, scope: "engineering", kind: "ALL_OF", role: "TOTAL" },
      { min: 2, scope: "Java", kind: "ALL_OF", role: "SUBSET" },
      { min: 1, scope: "AWS", kind: "ALL_OF", role: "SUBSET" },
    ]);
    expect(
      new Set(analysis.requirements.map((item) => item.relation?.groupId)),
    ).toEqual(new Set([analysis.requirements[0]?.relation?.groupId]));
  });

  it("preserves comma-separated included subsets under the total", () => {
    const requirements = analyzeJobExperience(
      "5+ years of engineering experience overall, including 2+ years Java, 1+ year AWS and 1+ year Kubernetes experience.",
    ).requirements;

    expect(
      requirements.map(({ years, relation }) => ({
        min: years.min,
        kind: relation?.kind,
        role: relation?.role,
        groupId: relation?.groupId,
      })),
    ).toEqual([
      { min: 5, kind: "ALL_OF", role: "TOTAL", groupId: expect.any(String) },
      { min: 2, kind: "ALL_OF", role: "SUBSET", groupId: expect.any(String) },
      { min: 1, kind: "ALL_OF", role: "SUBSET", groupId: expect.any(String) },
      { min: 1, kind: "ALL_OF", role: "SUBSET", groupId: expect.any(String) },
    ]);
    expect(
      new Set(requirements.map((item) => item.relation?.groupId)).size,
    ).toBe(1);
  });

  it.each([
    [
      "2 years to 4 years of backend experience",
      "RANGE",
      2,
      4,
      "2 years to 4 years",
    ],
    [
      "12 months - 18 months of commercial experience",
      "RANGE",
      1,
      1.5,
      "12 months - 18 months",
    ],
  ] as const)(
    "parses a repeated-unit duration range as one requirement: %s",
    (description, operator, min, max, text) => {
      const analysis = analyzeJobExperience(description);
      expect(analysis.requirements).toHaveLength(1);
      expect(analysis.requirements[0]?.years).toEqual({
        operator,
        min,
        max,
        text,
      });
    },
  );

  it.each([
    "3 or 4 years of backend experience",
    "3 to 5+ years of backend experience",
  ])(
    "keeps a structurally ambiguous duration out of the visible contract: %s",
    (description) => {
      const analysis = analyzeJobExperience(description);
      expect(analysis.requirements).toHaveLength(1);
      expect(analysis.requirements[0]?.classification).toBe("REVIEW");
    },
  );

  it("rejects malformed TOTAL/SUBSET relation groups at the public schema", () => {
    const valid = analyzeJobExperience(
      "Requirements:\n- 5 years of engineering experience overall, including 2 years of Java experience.",
    );
    expect(JobExperienceAnalysisSchema.safeParse(valid).success).toBe(true);

    const twoTotals = {
      ...valid,
      requirements: valid.requirements.map((requirement) => ({
        ...requirement,
        relation: requirement.relation
          ? { ...requirement.relation, role: "TOTAL" as const }
          : undefined,
      })),
    };
    expect(JobExperienceAnalysisSchema.safeParse(twoTotals).success).toBe(
      false,
    );

    const missingRole = {
      ...valid,
      requirements: valid.requirements.map((requirement, index) =>
        index === 1 && requirement.relation
          ? {
              ...requirement,
              relation: {
                groupId: requirement.relation.groupId,
                kind: requirement.relation.kind,
              },
            }
          : requirement,
      ),
    };
    expect(JobExperienceAnalysisSchema.safeParse(missingRole).success).toBe(
      false,
    );
  });

  it.each([
    ["12+ months of backend experience", "MINIMUM", 1, null, "12+ months"],
    [
      "18 months or more of backend experience",
      "MINIMUM",
      1.5,
      null,
      "18 months or more",
    ],
    [
      "Minimum 24 months of backend experience",
      "MINIMUM",
      2,
      null,
      "Minimum 24 months",
    ],
    ["3 years' experience in Java", "EXACT", 3, 3, "3 years"],
    ["2 yrs exp. in Go", "EXACT", 2, 2, "2 yrs"],
  ] as const)(
    "supports a high-value quantifiable duration form: %s",
    (description, operator, min, max, text) => {
      expect(analyzeJobExperience(description).requirements[0]?.years).toEqual({
        operator,
        min,
        max,
        text,
      });
    },
  );

  it("extracts a scope that precedes its year expression", () => {
    expect(
      analyzeJobExperience("Experience with Java: 5 years").requirements[0],
    ).toMatchObject({
      classification: "STATED",
      years: { min: 5 },
      scope: "Java",
    });
  });

  it.each([
    ["eleven years of product experience", 11],
    ["twenty-five years of consulting experience preferred", 25],
    ["sixty years of archival experience", 60],
  ] as const)(
    "supports an exact English number through sixty: %s",
    (description, min) => {
      expect(
        analyzeJobExperience(description).requirements[0]?.years,
      ).toMatchObject({
        operator: "EXACT",
        min,
        max: min,
      });
    },
  );

  it("normalizes a mixed years-and-months duration as one requirement", () => {
    const description =
      "2 years and 6 months of commercial software experience required.";

    const analysis = analyzeJobExperience(description);

    expect(analysis.requirements).toHaveLength(1);
    expect(analysis.requirements[0]).toMatchObject({
      classification: "REQUIRED",
      years: {
        operator: "EXACT",
        min: 2.5,
        max: 2.5,
        text: "2 years and 6 months",
      },
      scope: "commercial software",
    });
  });

  it.each([
    ["At least 18 months of data experience", "MINIMUM", 1.5, null],
    ["12-18 months of data experience", "RANGE", 1, 1.5],
    ["Up to 24 months of data experience preferred", "MAXIMUM", 0, 2],
    ["≥ 18 months of data experience", "MINIMUM", 1.5, null],
    ["≤ 24 months of data experience preferred", "MAXIMUM", 0, 2],
    ["More than 18 months of data experience", "MINIMUM", 1.5, null],
  ] as const)(
    "supports quantified month bounds and ranges: %s",
    (description, operator, min, max) => {
      expect(
        analyzeJobExperience(description).requirements[0]?.years,
      ).toMatchObject({
        operator,
        min,
        max,
      });
    },
  );

  it.each([
    ["More than 5 years of backend experience", "More than 5 years", 5],
    ["Over 7 years of cloud experience preferred", "Over 7 years", 7],
  ] as const)(
    "keeps an explicit open lower bound displayable: %s",
    (description, text, min) => {
      const requirement = analyzeJobExperience(description).requirements[0];
      expect(requirement?.classification).not.toBe("REVIEW");
      expect(requirement?.years).toEqual({
        operator: "MINIMUM",
        min,
        max: null,
        text,
      });
    },
  );

  it.each([
    ["5 years+ of backend experience required", "MINIMUM", 5, null, "5 years+"],
    ["5-year backend engineering experience required", "EXACT", 5, 5, "5-year"],
    [
      "five-year data engineering experience preferred",
      "EXACT",
      5,
      5,
      "five-year",
    ],
  ] as const)(
    "supports suffix-plus and hyphenated duration forms: %s",
    (description, operator, min, max, text) => {
      expect(analyzeJobExperience(description).requirements[0]).toMatchObject({
        years: { operator, min, max, text },
      });
    },
  );

  it("returns the versioned empty result when the JD has no usable text", () => {
    expect(analyzeJobExperience(null)).toEqual(EMPTY_JOB_EXPERIENCE_ANALYSIS);
    expect(analyzeJobExperience("   \n ")).toEqual({
      schemaVersion: 2,
      status: "NONE",
      requirements: [],
    });
    expect(
      JobExperienceAnalysisSchema.parse(analyzeJobExperience(undefined)),
    ).toEqual(EMPTY_JOB_EXPERIENCE_ANALYSIS);
  });

  it("extracts an explicit minimum with exact source offsets", () => {
    const description = [
      "Required qualifications:",
      "- At least 5 years of professional experience in backend engineering.",
    ].join("\n");

    expect(analyzeJobExperience(description)).toEqual({
      schemaVersion: 2,
      status: "FOUND",
      requirements: [
        {
          id: "experience-27-43",
          classification: "REQUIRED",
          years: {
            operator: "MINIMUM",
            min: 5,
            max: null,
            text: "At least 5 years",
          },
          scope: "backend engineering",
          evidence: {
            text: "At least 5 years of professional experience in backend engineering",
            start: 27,
            end: 93,
            yearsStart: 27,
            yearsEnd: 43,
          },
        },
      ],
    });
  });

  it.each([
    [
      "Requirements:\n- five+ years of experience in TypeScript",
      { operator: "MINIMUM", min: 5, max: null, text: "five+ years" },
    ],
    [
      "Minimum qualifications:\n- A minimum of ten years' experience",
      { operator: "MINIMUM", min: 10, max: null, text: "minimum of ten years" },
    ],
    [
      "Required qualifications:\n- 3-5 years of experience in cloud platforms",
      { operator: "RANGE", min: 3, max: 5, text: "3-5 years" },
    ],
    [
      "Required qualifications:\n- Between two and four years of commercial experience",
      {
        operator: "RANGE",
        min: 2,
        max: 4,
        text: "Between two and four years",
      },
    ],
    [
      "Requirements:\n- Up to 6 years of relevant experience",
      { operator: "MAXIMUM", min: 0, max: 6, text: "Up to 6 years" },
    ],
    [
      "Requirements:\n- 4 years of experience or less",
      {
        operator: "MAXIMUM",
        min: 0,
        max: 4,
        text: "4 years of experience or less",
      },
    ],
    [
      "Required qualifications:\n- seven years of product experience",
      { operator: "EXACT", min: 7, max: 7, text: "seven years" },
    ],
  ])("normalizes supported year expression %#", (description, expected) => {
    const analysis = analyzeJobExperience(description);

    expect(analysis.requirements[0]?.years).toEqual(expected);
  });

  it("lets a sentence qualifier override the inherited heading context", () => {
    const description = [
      "Required qualifications:",
      "- 3 years of Java experience is preferred.",
      "Preferred qualifications:",
      "- A minimum of 4 years of platform experience is mandatory.",
    ].join("\n");

    expect(
      analyzeJobExperience(description).requirements.map((requirement) => ({
        classification: requirement.classification,
        min: requirement.years.min,
      })),
    ).toEqual([
      { classification: "PREFERRED", min: 3 },
      { classification: "REQUIRED", min: 4 },
    ]);
  });

  it.each([
    ["Qualifications: 3+ years of backend experience", "REQUIRED"],
    ["Nice-to-haves: 2 years of React experience", "PREFERRED"],
  ] as const)(
    "inherits an inline section heading without corrupting offsets: %s",
    (description, classification) => {
      const requirement = analyzeJobExperience(description).requirements[0];

      expect(requirement?.classification).toBe(classification);
      expect(
        description.slice(
          requirement?.evidence.start,
          requirement?.evidence.end,
        ),
      ).toBe(requirement?.evidence.text);
    },
  );

  it.each([
    ["five (5) years of experience is required.", "EXACT", 5],
    ["5 or more years of experience is required.", "MINIMUM", 5],
    ["5 years of experience or more is required.", "MINIMUM", 5],
    ["not less than 5 years of experience is required.", "MINIMUM", 5],
    ["Minimum 5 yrs. experience in Java is required.", "MINIMUM", 5],
  ] as const)(
    "preserves the semantics of common AU JD wording: %s",
    (description, operator, minimum) => {
      const requirement = analyzeJobExperience(description).requirements[0];

      expect(requirement).toMatchObject({
        classification: "REQUIRED",
        years: { operator, min: minimum },
      });
      expect(
        description.slice(
          requirement?.evidence.yearsStart,
          requirement?.evidence.yearsEnd,
        ),
      ).toBe(requirement?.years.text);
    },
  );

  it("keeps generic grammar out of the experience scope label", () => {
    for (const description of [
      "five (5) years of experience is required.",
      "5 or more years of experience is required.",
      "5 years of experience or more is required.",
    ]) {
      expect(
        analyzeJobExperience(description).requirements[0]?.scope,
      ).toBeNull();
    }
    expect(
      analyzeJobExperience("Minimum 5 yrs. experience in Java is required.")
        .requirements[0]?.scope,
    ).toBe("Java");
  });

  it.each([
    ["5+ years of backend experience", "STATED"],
    ["Five years of backend experience", "STATED"],
    ["Five years of backend experience preferred", "PREFERRED"],
  ] as const)(
    "classifies an unheaded constraint from its own wording: %s",
    (description, classification) => {
      const analysis = analyzeJobExperience(description);

      expect({
        classification: analysis.requirements[0]?.classification,
        status: analysis.status,
      }).toEqual({
        classification,
        status: "FOUND",
      });
    },
  );

  it.each([
    "No 5 years of experience is required.",
    "Five years of experience is not required.",
    "You do not need 5 years of experience.",
    "Our company has operated successfully for 10 years.",
    "Our engineering team brings 20 years of combined experience.",
    "The contract duration is 2 years.",
    "Your temporary visa must remain valid for at least 3 years.",
    "A four year bachelor's degree is required.",
    "The graduate training programme runs for two years.",
    "The product launched 5 years ago.",
    "Applicants must be at least 18 years old.",
    "Annual leave increases after 5 years of service.",
    "Records must be retained for 7 years for audit purposes.",
  ])("does not treat non-role duration as experience: %s", (description) => {
    expect(analyzeJobExperience(description)).toEqual(
      EMPTY_JOB_EXPERIENCE_ANALYSIS,
    );
  });

  it("keeps a real applicant requirement even when the role is a contract", () => {
    const analysis = analyzeJobExperience(
      "For this 12-month contract, you must have at least 5 years of experience in Java.",
    );

    expect(
      analysis.requirements.map((requirement) => requirement.years.min),
    ).toEqual([5]);
  });

  it("keeps different scopes separate and records an AND relationship", () => {
    const analysis = analyzeJobExperience(
      "Requirements:\n- At least 3 years of Java experience and 2+ years of AWS experience.",
    );
    const [java, aws] = analysis.requirements;

    expect({
      scopes: analysis.requirements.map((requirement) => requirement.scope),
      years: analysis.requirements.map((requirement) => requirement.years.min),
      relationKinds: analysis.requirements.map(
        (requirement) => requirement.relation?.kind,
      ),
      sameGroup: java?.relation?.groupId === aws?.relation?.groupId,
    }).toEqual({
      scopes: ["Java", "AWS"],
      years: [3, 2],
      relationKinds: ["ALL_OF", "ALL_OF"],
      sameGroup: true,
    });
  });

  it("records alternative scoped requirements as ANY_OF", () => {
    const analysis = analyzeJobExperience(
      "Requirements:\n- 5 years in backend development or 3 years in mobile development.",
    );

    expect(
      analysis.requirements.map((requirement) => ({
        scope: requirement.scope,
        relation: requirement.relation?.kind,
      })),
    ).toEqual([
      { scope: "backend development", relation: "ANY_OF" },
      { scope: "mobile development", relation: "ANY_OF" },
    ]);
  });

  it("uses the nearest sentence qualifier for each related requirement", () => {
    const analysis = analyzeJobExperience(
      "3 years of Java experience required and 5 years of AWS experience preferred.",
    );

    expect(
      analysis.requirements.map((requirement) => requirement.classification),
    ).toEqual(["REQUIRED", "PREFERRED"]);
  });

  it("routes an approximate experience claim to review", () => {
    expect(
      analyzeJobExperience(
        "Around 5 years of professional experience is required.",
      ),
    ).toMatchObject({
      status: "REVIEW",
      requirements: [{ classification: "REVIEW" }],
    });
  });

  it("does not display a bare duration even under a requirements heading", () => {
    expect(analyzeJobExperience("Requirements:\n- 5 years.")).toEqual(
      EMPTY_JOB_EXPERIENCE_ANALYSIS,
    );
  });

  it("parses a decimal as one requirement rather than its integer tail", () => {
    expect(
      analyzeJobExperience("A minimum of 3.5 years of experience is required.")
        .requirements[0]?.years,
    ).toEqual({
      operator: "MINIMUM",
      min: 3.5,
      max: null,
      text: "minimum of 3.5 years",
    });
  });

  it.each([
    [
      "Requirements:\n- 3 years of backend experience minimum.",
      { operator: "MINIMUM", classification: "REQUIRED" },
    ],
    [
      "Requirements:\n- 3 yrs exp required.",
      { operator: "EXACT", classification: "REQUIRED" },
    ],
    [
      "Requirements:\n- Less than 3 years of experience.",
      { operator: "MAXIMUM", classification: "REVIEW" },
    ],
  ] as const)(
    "does not overstate common experience wording: %s",
    (description, expected) => {
      const requirement = analyzeJobExperience(description).requirements[0];

      expect({
        operator: requirement?.years.operator,
        classification: requirement?.classification,
      }).toEqual(expected);
    },
  );

  it("ignores unrelated year durations outside a requirement context", () => {
    expect(analyzeJobExperience("Our office lease runs for 5 years.")).toEqual(
      EMPTY_JOB_EXPERIENCE_ANALYSIS,
    );
    expect(
      analyzeJobExperience(
        "Requirements:\n- 3 years of backend experience.\nBenefits:\n- Share awards vest over 4 years.",
      ).requirements.map(({ years }) => years.min),
    ).toEqual([3]);
    expect(
      analyzeJobExperience(
        "Requirements:\n- 3 years of backend experience.\nResponsibilities:\n- Deliver the roadmap over 5 years.",
      ).requirements.map(({ years }) => years.min),
    ).toEqual([3]);
  });

  it("bounds evidence from a long unpunctuated line without losing source offsets", () => {
    const prefix = "Required: at least 4 years of backend experience ";
    const description = `${prefix}${"context ".repeat(500)}`;
    const analysis = analyzeJobExperience(description);
    const requirement = analysis.requirements[0];

    expect(requirement).toBeDefined();
    expect(requirement?.evidence.text.length).toBeLessThanOrEqual(2_000);
    expect(
      description.slice(requirement?.evidence.start, requirement?.evidence.end),
    ).toBe(requirement?.evidence.text);
    expect(
      description.slice(
        requirement?.evidence.yearsStart,
        requirement?.evidence.yearsEnd,
      ),
    ).toBe(requirement?.years.text);
  });

  it("rejects malformed persisted analyses at the shared schema seam", () => {
    const valid = analyzeJobExperience(
      "Requirements:\n- At least 3 years of backend experience.",
    );
    const requirement = valid.requirements[0];
    expect(requirement).toBeDefined();

    expect(
      JobExperienceAnalysisSchema.safeParse({ ...valid, unexpected: true })
        .success,
    ).toBe(false);
    expect(
      JobExperienceAnalysisSchema.safeParse({
        ...valid,
        requirements: [
          {
            ...requirement,
            evidence: {
              ...requirement?.evidence,
              yearsStart: (requirement?.evidence.start ?? 0) - 1,
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      JobExperienceAnalysisSchema.safeParse({
        ...valid,
        requirements: [
          {
            ...requirement,
            years: { ...requirement?.years, operator: "EXACT", max: 4 },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      JobExperienceAnalysisSchema.safeParse({
        ...valid,
        requirements: [
          {
            ...requirement,
            years: { ...requirement?.years, text: "3 years padded" },
          },
        ],
      }).success,
    ).toBe(false);

    const duplicate = { ...requirement, id: "duplicate" };
    expect(
      JobExperienceAnalysisSchema.safeParse({
        schemaVersion: 1,
        status: "FOUND",
        requirements: [duplicate, duplicate],
      }).success,
    ).toBe(false);
    expect(
      JobExperienceAnalysisSchema.safeParse({
        schemaVersion: 1,
        status: "FOUND",
        requirements: [
          {
            ...requirement,
            relation: { groupId: "single", kind: "ANY_OF" },
          },
        ],
      }).success,
    ).toBe(false);

    const related = analyzeJobExperience(
      "Requirements:\n- 3 years of Java experience and 2 years of AWS experience.",
    );
    expect(related.requirements).toHaveLength(2);
    expect(
      JobExperienceAnalysisSchema.safeParse({
        ...related,
        requirements: related.requirements.map((item, index) =>
          index === 1 && item.relation
            ? { ...item, relation: { ...item.relation, kind: "ANY_OF" } }
            : item,
        ),
      }).success,
    ).toBe(false);
  });

  it("does not confuse the hiring team's wording with company tenure", () => {
    const analysis = analyzeJobExperience(
      "Our team has an opening for applicants with 5+ years of backend experience.",
    );

    expect(analysis.requirements).toHaveLength(1);
    expect(analysis.requirements[0]?.years.min).toBe(5);
  });

  it("keeps an explicitly preferred threshold even when it is not required", () => {
    const analysis = analyzeJobExperience(
      "Three years of React experience is preferred but not required.",
    );

    expect(analysis.requirements[0]?.classification).toBe("PREFERRED");
  });

  it("inherits HTML and Markdown headings without changing original offsets", () => {
    const html =
      "<h3>Requirements</h3><ul><li>At least five years of experience in data engineering.</li></ul>";
    const markdown =
      "## Preferred qualifications\n- 3+ years of experience with React.";
    const htmlAnalysis = analyzeJobExperience(html);
    const markdownAnalysis = analyzeJobExperience(markdown);
    const htmlRequirement = htmlAnalysis.requirements[0];
    const markdownRequirement = markdownAnalysis.requirements[0];

    expect({
      htmlClassification: htmlRequirement?.classification,
      htmlEvidenceMatches:
        html.slice(
          htmlRequirement?.evidence.start,
          htmlRequirement?.evidence.end,
        ) === htmlRequirement?.evidence.text,
      htmlYearsMatches:
        html.slice(
          htmlRequirement?.evidence.yearsStart,
          htmlRequirement?.evidence.yearsEnd,
        ) === htmlRequirement?.years.text,
      markdownClassification: markdownRequirement?.classification,
      markdownEvidenceMatches:
        markdown.slice(
          markdownRequirement?.evidence.start,
          markdownRequirement?.evidence.end,
        ) === markdownRequirement?.evidence.text,
    }).toEqual({
      htmlClassification: "REQUIRED",
      htmlEvidenceMatches: true,
      htmlYearsMatches: true,
      markdownClassification: "PREFERRED",
      markdownEvidenceMatches: true,
    });
  });

  it("deterministically caps noisy JDs at the schema limit", () => {
    const description = [
      "Requirements:",
      ...Array.from(
        { length: 45 },
        (_, index) =>
          `- At least ${index + 1} years of experience in capability ${index + 1}.`,
      ),
    ].join("\n");

    const first = analyzeJobExperience(description);
    const second = analyzeJobExperience(description);
    expect({
      count: first.requirements.length,
      status: first.status,
      truncated: first.truncated,
      stableIds: first.requirements.map(({ id }) => id),
    }).toEqual({
      count: 40,
      status: "REVIEW",
      truncated: true,
      stableIds: second.requirements.map(({ id }) => id),
    });
  });

  it("truncates one oversized relation group without throwing or claiming completeness", () => {
    const description = `Applicants need ${Array.from(
      { length: 41 },
      (_, index) => `${index + 1} years of capability${index} experience`,
    ).join(" and ")}.`;

    expect(analyzeJobExperience(description)).toMatchObject({
      schemaVersion: 2,
      status: "REVIEW",
      truncated: true,
      requirements: [],
    });
  });

  it.each([
    ["3 years Java required or 2 years Kotlin", "REQUIRED", "ANY_OF"],
    ["3 years Java preferred and 2 years Kotlin", "PREFERRED", "ALL_OF"],
  ] as const)(
    "propagates one explicit qualifier across a simple homogeneous relation: %s",
    (description, classification, relation) => {
      const analysis = analyzeJobExperience(description);

      expect(
        analysis.requirements.map((requirement) => ({
          classification: requirement.classification,
          relation: requirement.relation?.kind,
          scope: requirement.scope,
        })),
      ).toEqual([
        { classification, relation, scope: "Java" },
        { classification, relation, scope: "Kotlin" },
      ]);
    },
  );

  it.each([
    "3 years Java required or 2 years Kotlin and 1 year Go",
    "3 years Java required and/or 2 years Kotlin",
    "3 years Java required or 2 years Kotlin if the team approves",
    "3 years Java required or 2 years Kotlin unless the client objects",
    "3 years Java required or 2 years Kotlin provided that funding continues",
    "3 years Java required or 2 years Kotlin depending on the project",
  ])("fails closed for an unsafe relation path: %s", (description) => {
    const analysis = analyzeJobExperience(description);

    expect({
      status: analysis.status,
      classifications: analysis.requirements.map(
        (requirement) => requirement.classification,
      ),
      relations: analysis.requirements.map(
        (requirement) => requirement.relation,
      ),
    }).toEqual({
      status: "REVIEW",
      classifications: Array.from(
        { length: analysis.requirements.length },
        () => "REVIEW",
      ),
      relations: Array.from(
        { length: analysis.requirements.length },
        () => undefined,
      ),
    });
    expect(analysis.requirements.length).toBeGreaterThan(1);
  });

  it("inherits a required heading through inline Markdown emphasis", () => {
    const description =
      "Required qualifications:\n- **3+ years** of experience in Java.";
    const requirement = analyzeJobExperience(description).requirements[0];

    expect({
      classification: requirement?.classification,
      years: requirement?.years.text,
      evidenceMatches:
        description.slice(
          requirement?.evidence.start,
          requirement?.evidence.end,
        ) === requirement?.evidence.text,
    }).toEqual({
      classification: "REQUIRED",
      years: "3+ years",
      evidenceMatches: true,
    });
  });
});
