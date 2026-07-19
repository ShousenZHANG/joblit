import { describe, expect, it } from "vitest";

import {
  analyzeJobStructuralGates,
  analyzeJobTechnicalRequirements,
} from "./jdTechnicalAnalysis";

describe("analyzeJobTechnicalRequirements", () => {
  it("ranks explicit gates, core work and preferred technology separately", () => {
    const result = analyzeJobTechnicalRequirements(`
      Must-haves:
      - 5+ years building production services with C# and .NET.
      Responsibilities:
      - Design APIs in ASP.NET Core and deploy them to Azure.
      Nice to have:
      - React Native exposure.
    `);

    expect(result.map((item) => [item.skill, item.priority, item.isGate])).toEqual([
      ["C#", "REQUIRED", true],
      [".NET", "REQUIRED", true],
      ["ASP.NET", "CORE", false],
      ["Azure", "CORE", false],
      ["React Native", "PREFERRED", false],
    ]);
  });

  it("prefers the strongest occurrence and preserves concise evidence", () => {
    const result = analyzeJobTechnicalRequirements(`
      Our platform uses Kubernetes.
      Requirements: Kubernetes production experience is required.
    `);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      skill: "Kubernetes",
      priority: "REQUIRED",
      isGate: true,
    });
    expect(result[0]?.evidence).toContain("required");
  });

  it("ignores benefits and company-decoration technology", () => {
    const result = analyzeJobTechnicalRequirements(`
      About the company:
      We provide AWS credits and GitHub access to every employee.
      What we offer:
      Free Kubernetes training and an Azure certification budget.
      Requirements:
      Build APIs with TypeScript and PostgreSQL.
    `);
    expect(result.map((item) => item.skill)).toEqual([
      "TypeScript",
      "PostgreSQL",
    ]);
  });

  it("does not turn a negated experience statement into a gate", () => {
    const result = analyzeJobTechnicalRequirements(
      "No prior React experience is required. You will build services with Node.js.",
    );
    expect(result.find((item) => item.skill === "React")).toMatchObject({
      priority: "MENTIONED",
      isGate: false,
    });
    expect(result.find((item) => item.skill === "Node.js")).toMatchObject({
      priority: "CORE",
      isGate: false,
    });
    expect(
      analyzeJobTechnicalRequirements("React is not required.")[0],
    ).toMatchObject({
      skill: "React",
      priority: "MENTIONED",
      isGate: false,
    });
  });

  it("keeps strong experience language required without inventing a hard gate", () => {
    const result = analyzeJobTechnicalRequirements(
      "Hands-on experience with Kubernetes and proven Terraform delivery.",
    );
    expect(result).toEqual([
      expect.objectContaining({
        skill: "Kubernetes",
        priority: "REQUIRED",
        isGate: false,
      }),
      expect.objectContaining({
        skill: "Terraform",
        priority: "REQUIRED",
        isGate: false,
      }),
    ]);

    expect(
      analyzeJobTechnicalRequirements("Must have Kubernetes experience.")[0],
    ).toMatchObject({ skill: "Kubernetes", isGate: true });
  });

  it("handles inline headings and managed-cloud compound terms", () => {
    const result = analyzeJobTechnicalRequirements(
      "Minimum requirements: Kubernetes on AWS EKS, Terraform and Go.",
    );
    expect(result.map((item) => item.skill)).toEqual([
      "Kubernetes",
      "Amazon EKS",
      "Terraform",
      "Go",
    ]);
    expect(result.every((item) => item.isGate)).toBe(true);
  });

  it("returns no invented requirements for empty or non-technical JDs", () => {
    expect(analyzeJobTechnicalRequirements("")).toEqual([]);
    expect(
      analyzeJobTechnicalRequirements("Join a collaborative, inclusive team."),
    ).toEqual([]);
  });
});

describe("analyzeJobStructuralGates", () => {
  it("extracts explicit non-technical gates with source evidence", () => {
    const result = analyzeJobStructuralGates(`
      Minimum requirements:
      - At least 5 years of professional experience.
      - Must hold NV1 security clearance.
      - A valid driver's licence is required.
      - Must be based in Sydney and work on-site.
      - Applicants need unrestricted Australian work rights.
    `);

    expect(result.map(({ kind }) => kind)).toEqual([
      "EXPERIENCE",
      "CLEARANCE",
      "LICENCE",
      "LOCATION",
      "WORK_RIGHTS",
    ]);
    expect(result.every(({ evidence }) => evidence.length > 0)).toBe(true);
  });

  it("rejects negated, preferred, and sponsorship-offered false gates", () => {
    expect(
      analyzeJobStructuralGates(`
        Security clearance is not required.
        Australian citizenship preferred.
        Visa sponsorship is available.
        A driver's licence is nice to have.
        Hybrid work is optional.
      `),
    ).toEqual([]);
  });
});
