import { describe, expect, it } from "vitest";

import {
  EMPTY_JOB_EXPERIENCE_ANALYSIS,
  JobExperienceAnalysisSchema,
  analyzeJobExperience,
} from "./jobExperienceAnalysis";

describe("analyzeJobExperience", () => {
  it("returns the versioned empty result when the JD has no usable text", () => {
    expect(analyzeJobExperience(null)).toEqual(
      EMPTY_JOB_EXPERIENCE_ANALYSIS,
    );
    expect(analyzeJobExperience("   \n ")).toEqual({
      schemaVersion: 1,
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
      schemaVersion: 1,
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
      expect(analyzeJobExperience(description).requirements[0]?.scope).toBeNull();
    }
    expect(
      analyzeJobExperience(
        "Minimum 5 yrs. experience in Java is required.",
      ).requirements[0]?.scope,
    ).toBe("Java");
  });

  it.each([
    ["5+ years of backend experience", "REVIEW"],
    ["Five years of backend experience", "REVIEW"],
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
        status: classification === "REVIEW" ? "REVIEW" : "FOUND",
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

    expect(analysis.requirements.map((requirement) => requirement.years.min)).toEqual([
      5,
    ]);
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

  it.each([
    "Around 5 years of professional experience is required.",
    "Required qualifications:\n- More than 5 years of platform experience.",
    "Requirements:\n- 5 years.",
  ])("routes a plausible but non-exact experience claim to review: %s", (description) => {
    const analysis = analyzeJobExperience(description);

    expect({
      status: analysis.status,
      classifications: analysis.requirements.map(
        (requirement) => requirement.classification,
      ),
    }).toEqual({ status: "REVIEW", classifications: ["REVIEW"] });
  });

  it("does not reinterpret the decimal tail as a whole-number requirement", () => {
    expect(
      analyzeJobExperience("A minimum of 3.5 years of experience is required."),
    ).toEqual(EMPTY_JOB_EXPERIENCE_ANALYSIS);
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
    expect(
      analyzeJobExperience("Our office lease runs for 5 years."),
    ).toEqual(EMPTY_JOB_EXPERIENCE_ANALYSIS);
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
      description.slice(
        requirement?.evidence.start,
        requirement?.evidence.end,
      ),
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
      schemaVersion: 1,
      status: "REVIEW",
      truncated: true,
      requirements: [],
    });
  });

  it.each([
    [
      "3 years Java required or 2 years Kotlin",
      "REQUIRED",
      "ANY_OF",
    ],
    [
      "3 years Java preferred and 2 years Kotlin",
      "PREFERRED",
      "ALL_OF",
    ],
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
