import { describe, expect, it } from "vitest";

import {
  EMPTY_JOB_EXPERIENCE_ANALYSIS,
  JobExperienceAnalysisSchema,
  analyzeJobExperience,
} from "./jobExperienceAnalysis";
import {
  LegacyJobExperienceAnalysisSchema,
  LegacyJobExperienceAnalysisV2Schema,
  projectJobExperienceAnalysisV1,
  projectJobExperienceAnalysisV2,
  upgradeJobExperienceAnalysisV1,
  upgradeJobExperienceAnalysisV2,
} from "./jobExperienceAnalysisCompat";

describe("analyzeJobExperience v3 contract", () => {
  it("exposes one deterministic offline seam and a versioned empty value", () => {
    expect(analyzeJobExperience(null)).toEqual(EMPTY_JOB_EXPERIENCE_ANALYSIS);
    expect(analyzeJobExperience(" \n ")).toEqual({
      schemaVersion: 3,
      status: "NONE",
      requirements: [],
    });
    expect(
      JobExperienceAnalysisSchema.safeParse({
        ...analyzeJobExperience("Requirements:\n- 3 years of Java experience"),
        schemaVersion: 2,
      }).success,
    ).toBe(false);
  });

  it.each([
    [
      "More than 5 years of backend experience is required",
      "MORE_THAN",
      5,
      null,
    ],
    ["> 3 years of backend experience is required", "MORE_THAN", 3, null],
    ["At least 4 years of backend experience", "AT_LEAST", 4, null],
    [">= 2 years of backend experience", "AT_LEAST", 2, null],
    ["5+ years of backend experience", "AT_LEAST", 5, null],
    ["Less than 3 years of backend experience is required", "LESS_THAN", 0, 3],
    ["< 2 years of backend experience is required", "LESS_THAN", 0, 2],
    ["At most 5 years of backend experience", "AT_MOST", 0, 5],
    ["Up to 4 years of backend experience", "AT_MOST", 0, 4],
    ["<= 6 years of backend experience", "AT_MOST", 0, 6],
    ["Exactly 3 years of backend experience", "EXACT", 3, 3],
    ["3-5 years of backend experience", "RANGE", 3, 5],
  ] as const)(
    "preserves precise comparison semantics: %s",
    (wording, operator, min, max) => {
      const requirement = analyzeJobExperience(`Requirements:\n- ${wording}`)
        .requirements[0];
      expect(requirement?.years).toMatchObject({ operator, min, max });
      expect(requirement?.classification).toBe("REQUIRED");
    },
  );

  it.each([
    ["1 year 6 months of Java experience is required", 1.5, "1 year 6 months"],
    ["1y6m of Java experience is required", 1.5, "1y6m"],
    [
      "2 yrs and 3 mos of platform experience is required",
      2.25,
      "2 yrs and 3 mos",
    ],
    ["18 months of backend experience is required", 1.5, "18 months"],
  ] as const)(
    "merges compound and month quantities: %s",
    (wording, min, text) => {
      const analysis = analyzeJobExperience(`Qualifications:\n- ${wording}`);
      expect(analysis.requirements).toHaveLength(1);
      expect(analysis.requirements[0]?.years).toMatchObject({
        operator: "EXACT",
        min,
        max: min,
        text,
      });
    },
  );

  it("applies a bound to the complete years-and-months quantity", () => {
    expect(
      analyzeJobExperience(
        "Qualifications:\n- At least 1 year 6 months of platform experience",
      ).requirements[0]?.years,
    ).toMatchObject({ operator: "AT_LEAST", min: 1.5, max: null });
  });

  it.each([
    "Requirements",
    "Required Skills & Experience",
    "Qualifications",
    "What you'll bring",
    "About you",
    "Who you are",
    "Experience",
  ])("treats candidate quantities in %s as REQUIRED", (heading) => {
    expect(
      analyzeJobExperience(`${heading}:\n- 3 years of .NET platform experience`)
        .requirements[0]?.classification,
    ).toBe("REQUIRED");
  });

  it("keeps non-required domain evidence but makes isolated wording REVIEW", () => {
    expect(
      analyzeJobExperience("5 years of backend experience").requirements[0]
        ?.classification,
    ).toBe("REVIEW");
    expect(
      analyzeJobExperience("5 years of React experience is preferred")
        .requirements[0]?.classification,
    ).toBe("PREFERRED");
    expect(
      analyzeJobExperience(
        "A bachelor's degree or 4 years of equivalent professional experience is required",
      ).requirements[0]?.classification,
    ).toBe("ALTERNATIVE");
    expect(
      analyzeJobExperience(
        "We prefer candidates with 3 years of React experience, but it is not required.",
      ).requirements[0]?.classification,
    ).toBe("PREFERRED");
  });

  it.each([
    ["Experience: 5+ years", "AT_LEAST", 5, "5+ years"],
    ["Minimum overall experience: 5 years", "AT_LEAST", 5, "5 years"],
    ["Minimum Experience (Years): 5", "AT_LEAST", 5, "5"],
  ] as const)(
    "parses a narrow ATS labelled field: %s",
    (description, operator, min, text) => {
      const requirement = analyzeJobExperience(description).requirements[0];
      expect(requirement).toMatchObject({
        classification: "REQUIRED",
        years: { operator, min, text },
      });
      expect(
        description.slice(
          requirement?.evidence.yearsStart,
          requirement?.evidence.yearsEnd,
        ),
      ).toBe(text);
    },
  );
});

describe("candidate ownership and false-positive safety", () => {
  it.each([
    "3 yrs of Java experience",
    "3 yrs. of Java experience",
    "Minimum three years of cloud experience",
    "A minimum of 3 years of data experience",
    "No fewer than 3 years of backend experience",
    "Not less than 3 years of platform experience",
    "3 years of Java experience or more",
    "3 years of Java experience and above",
    "3 years of Java experience minimum",
    "3 years of Java experience required",
    "Between 2 and 4 years of commercial experience",
    "2 years to 4 years of backend experience",
    "24 months of backend experience",
    "At least 18 months of data experience",
    "12-18 months of commercial experience",
    "Up to 24 months of platform experience",
    "More than 18 months of data experience",
    "Five years of software experience",
    "five (5) years of product experience",
    "five-year data engineering experience",
    "5 years+ of backend experience",
    "5+ years of backend experience",
    "5 yrs experience in Java",
    "3.5 years of platform experience",
    "3.5+ years of platform experience",
    "1 yr 6 mos of engineering experience",
    "2y3m of commercial experience",
    "No more than 5 years of industry experience",
    "Under 4 years of professional experience",
    "4 years of relevant experience or less",
    "Experience in Go: 4 years",
    "4 years working in data engineering",
    "4 years as a software engineer",
    "\u2265 4 years of cloud experience",
    "\u2264 5 years of backend experience",
    "> 5 years of security experience",
    "< 5 years of mobile experience",
    "<strong>Qualifications</strong><ul><li>3 years of Java experience</li></ul>",
    "| Minimum experience | 5 years |",
    "<table><tr><td>Minimum experience</td><td>5 years</td></tr></table>",
  ])("recognizes a high-confidence AU JD form: %s", (line) => {
    const description =
      line.startsWith("<strong") ||
      line.startsWith("<table") ||
      line.startsWith("|")
        ? line
        : `Qualifications:\n- ${line}`;
    const requirement = analyzeJobExperience(description).requirements[0];
    expect(requirement).toBeDefined();
    expect(requirement?.classification).toBe("REQUIRED");
    expect(
      description.slice(
        requirement?.evidence.yearsStart,
        requirement?.evidence.yearsEnd,
      ),
    ).toBe(requirement?.years.text);
  });

  it.each([
    "Our company has operated for 25 years.",
    "Our team brings 20 years of combined software experience.",
    "The founder has 18 years of product experience.",
    "You will report to a manager with 15 years of engineering experience.",
    "Our customer has 12 years of banking experience.",
    "Our customers require 5 years of experience from their vendors.",
    "The client requires 7 years experience from its lead consultant.",
    "The role includes a four year bachelor's degree pathway.",
    "Complete a 3-year graduate program.",
    "This is a 2-year contract.",
    "Your temporary visa must remain valid for at least 3 years.",
    "Applicants must have lived in Australia for 5 years.",
    "The project roadmap spans 5 years.",
    "Records must be retained for 7 years.",
    "The product launched 5 years ago.",
    "Applicants must be at least 18 years old.",
  ])("does not expose a foreign or non-role duration: %s", (description) => {
    expect(analyzeJobExperience(`Requirements:\n- ${description}`)).toEqual(
      EMPTY_JOB_EXPERIENCE_ANALYSIS,
    );
  });

  it.each([
    "You must be available for the next 3 years.",
    "The engagement lasts for 2 years.",
    "This assignment runs for 3 years.",
    "Deliver the roadmap over 5 years.",
    "The delivery timeline covers 4 years.",
    "The visa is valid for 3 years.",
    "Your passport must remain valid for 2 years.",
    "Permanent residency held for 5 years is required.",
    "Citizenship must have been held for 4 years.",
    "Work rights must remain valid for 2 years.",
    "Complete a four-year degree.",
    "A 2-year diploma is offered.",
    "Attend a 3-year university program.",
    "The course takes 2 years.",
    "Training runs for 18 months.",
    "The internship lasts 12 months.",
    "The apprenticeship is a 4-year program.",
    "The warranty covers 5 years.",
    "The licence remains valid for 3 years.",
    "Registration must be renewed every 2 years.",
    "Membership has been active for 5 years.",
    "Clearance renewal occurs after 3 years.",
    "The certification is valid for 2 years.",
    "Retention policy requires 7 years.",
    "Annual leave increases after 5 years of service.",
    "The successful applicant must be at least 21 years old.",
    "The company was founded 12 years ago.",
    "The organisation was established 30 years ago.",
    "The firm has served customers for 20 years.",
    "The manager offers 15 years of engineering experience.",
    "The leadership team has 40 years of combined experience.",
    "The platform has existed for 8 years.",
    "The contract term is 6 months.",
    "The rotational program lasts 2 years.",
    "Funding is secured for 4 years.",
    "You must be located in Sydney for 3 years.",
    "Candidates must be based in Australia for 2 years.",
    "Applicants must have resided locally for 5 years.",
    "Record-keeping is required for 7 years.",
    "Audit files are held for 6 years.",
    "The project runs over 3 years.",
    "The product launched 5 years ago.",
  ])("keeps a duration-only AU JD statement hidden: %s", (line) => {
    expect(
      analyzeJobExperience(`Requirements:\n- ${line}`).requirements,
    ).toEqual([]);
  });

  it("uses the nearest semantic owner instead of rejecting a company lead-in", () => {
    const analysis = analyzeJobExperience(
      "Our team has an opening for applicants who must have 5+ years of backend experience.",
    );
    expect(analysis.requirements).toHaveLength(1);
    expect(analysis.requirements[0]).toMatchObject({
      classification: "REQUIRED",
      years: { operator: "AT_LEAST", min: 5 },
    });
  });

  it("keeps candidate experience in a sentence that also describes a contract", () => {
    const analysis = analyzeJobExperience(
      "For this 12-month contract, you must have at least 5 years of experience in Java.",
    );
    expect(analysis.requirements.map((item) => item.years.min)).toEqual([5]);
  });

  it("keeps candidate experience when a location gate shares the sentence", () => {
    const description =
      "Minimum requirements: Applicants must have unrestricted Australian work rights, hold NV1 security clearance, possess a valid driver's licence, be based in Sydney, and have at least 5 years of professional experience.";
    const analysis = analyzeJobExperience(description);

    expect(analysis.requirements).toHaveLength(1);
    expect(analysis.requirements[0]).toMatchObject({
      classification: "REQUIRED",
      years: {
        operator: "AT_LEAST",
        min: 5,
        max: null,
        text: "at least 5 years",
      },
    });
    const requirement = analysis.requirements[0];
    expect(
      description.slice(
        requirement?.evidence.yearsStart,
        requirement?.evidence.yearsEnd,
      ),
    ).toBe(requirement?.years.text);
    expect(
      description.slice(requirement?.evidence.start, requirement?.evidence.end),
    ).toBe(requirement?.evidence.text);
  });

  it("suppresses a recency window without suppressing the actual requirement", () => {
    const description =
      "Requirements:\n- At least 3 years of Java experience within the last 5 years.";
    const analysis = analyzeJobExperience(description);
    expect(analysis.requirements).toHaveLength(1);
    expect(analysis.requirements[0]?.years).toMatchObject({
      operator: "AT_LEAST",
      min: 3,
      text: "At least 3 years",
    });
    expect(analysis.requirements.map((item) => item.years.text)).not.toContain(
      "last 5 years",
    );
  });
});

describe("scope, section and source-offset fidelity", () => {
  it.each([
    ["Experience: at least 4 years in Java", "Java"],
    ["Experience with Node.js: at least 3 years", "Node.js"],
    ["At least 3 years of .NET platform experience", ".NET platform"],
    ["At least 2 years of C#/.NET experience", "C#/.NET"],
    ["3 years .NET required", ".NET"],
    [
      "At least 5 years' track record in cloud engineering",
      "cloud engineering",
    ],
  ] as const)(
    "extracts candidate scope without punctuation loss: %s",
    (line, scope) => {
      const requirement = analyzeJobExperience(`Requirements:\n- ${line}`)
        .requirements[0];
      expect(requirement?.scope).toBe(scope);
    },
  );

  it.each([
    "## Requirements\n- **3+ years** of experience in Java.",
    "<h3>Qualifications</h3><ul><li>At least 4 years of .NET experience.</li></ul>",
    "About us: We build software. About you: 5+ years of backend experience.",
  ])(
    "keeps exact original evidence offsets through formatted input",
    (description) => {
      const requirement = analyzeJobExperience(description).requirements[0];
      expect(requirement).toBeDefined();
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
    },
  );

  it("fails closed when no quantitative candidate evidence exists", () => {
    expect(
      analyzeJobExperience(
        "Qualifications:\n- Strong Java experience and an excellent track record.",
      ),
    ).toEqual(EMPTY_JOB_EXPERIENCE_ANALYSIS);
  });
});

describe("relations and bounded output", () => {
  it("models an overall requirement and included subset", () => {
    const analysis = analyzeJobExperience(
      "Requirements:\n- 5+ years of engineering experience, including 2+ years of Java experience.",
    );
    expect(
      analysis.requirements.map((item) => ({
        min: item.years.min,
        scope: item.scope,
        kind: item.relation?.kind,
        role: item.relation?.role,
      })),
    ).toEqual([
      { min: 5, scope: "engineering", kind: "ALL_OF", role: "TOTAL" },
      { min: 2, scope: "Java", kind: "ALL_OF", role: "SUBSET" },
    ]);
  });

  it.each([
    ["3 years Java required and 2 years Kotlin", "ALL_OF"],
    ["3 years Java required or 2 years Kotlin", "ANY_OF"],
  ] as const)("groups a homogeneous relation: %s", (wording, kind) => {
    const analysis = analyzeJobExperience(wording);
    expect(analysis.requirements).toHaveLength(2);
    expect(analysis.requirements.map((item) => item.classification)).toEqual([
      "REQUIRED",
      "REQUIRED",
    ]);
    expect(analysis.requirements.map((item) => item.relation?.kind)).toEqual([
      kind,
      kind,
    ]);
  });

  it("fails closed for a mixed relation", () => {
    const analysis = analyzeJobExperience(
      "3 years Java required or 2 years Kotlin and 1 year Go",
    );
    expect(analysis.requirements.length).toBeGreaterThan(1);
    expect(
      analysis.requirements.every((item) => item.classification === "REVIEW"),
    ).toBe(true);
    expect(
      analysis.requirements.every((item) => item.relation === undefined),
    ).toBe(true);
  });

  it("caps noisy descriptions deterministically and drops a partial group", () => {
    const description = `Applicants need ${Array.from(
      { length: 41 },
      (_, index) => `${index + 1} years of capability${index} experience`,
    ).join(" and ")}.`;
    expect(analyzeJobExperience(description)).toMatchObject({
      schemaVersion: 3,
      status: "REVIEW",
      truncated: true,
      requirements: [],
    });
  });
});

describe("v3 compatibility projections", () => {
  it("projects exact comparison values into the closest frozen v2 shape", () => {
    const v3 = analyzeJobExperience(
      "Requirements:\n- More than 3 years of Java experience and less than 8 years of platform experience.",
    );
    const v2 = projectJobExperienceAnalysisV2(v3);
    expect(LegacyJobExperienceAnalysisV2Schema.safeParse(v2).success).toBe(
      true,
    );
    expect(v2.requirements.map((item) => item.years.operator)).toEqual([
      "MINIMUM",
      "MAXIMUM",
    ]);
    expect(
      upgradeJobExperienceAnalysisV2(v2).requirements.map(
        (item) => item.years.operator,
      ),
    ).toEqual(["AT_LEAST", "AT_MOST"]);
  });

  it("keeps v1 integer-only and removes an orphan relation", () => {
    const v3 = analyzeJobExperience(
      "Requirements:\n- 2 years of backend experience and 18 months of Java experience.",
    );
    const v1 = projectJobExperienceAnalysisV1(v3);
    expect(LegacyJobExperienceAnalysisSchema.safeParse(v1).success).toBe(true);
    expect(v1.requirements).toHaveLength(1);
    expect(v1.requirements[0]).not.toHaveProperty("relation");
    expect(upgradeJobExperienceAnalysisV1(v1)).toMatchObject({
      schemaVersion: 3,
      requirements: [{ years: { operator: "EXACT", min: 2 } }],
    });
  });

  it("rejects malformed v3 comparison bounds at the public seam", () => {
    const valid = analyzeJobExperience(
      "Requirements:\n- At least 3 years of backend experience.",
    );
    const requirement = valid.requirements[0];
    expect(requirement).toBeDefined();
    expect(
      JobExperienceAnalysisSchema.safeParse({
        ...valid,
        requirements: [
          {
            ...requirement,
            years: { ...requirement?.years, operator: "MORE_THAN", max: 3 },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
