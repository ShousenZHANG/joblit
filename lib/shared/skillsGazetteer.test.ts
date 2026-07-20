import { describe, it, expect } from "vitest";
import {
  SKILLS_GAZETTEER,
  SKILL_CATEGORIES,
  categoryForSkill,
  expandSkillSet,
  extractSkillMentions,
  extractSkills,
} from "./skillsGazetteer";

describe("SKILLS_GAZETTEER", () => {
  it("has no duplicate canonical names", () => {
    const names = SKILLS_GAZETTEER.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every entry has at least one alias OR an empty-alias opt-out", () => {
    // Some entries intentionally have empty aliases (too noisy, e.g. "R", "C")
    // but should still be structurally valid.
    for (const entry of SKILLS_GAZETTEER) {
      expect(entry.name).toBeTruthy();
      expect(Array.isArray(entry.aliases)).toBe(true);
    }
  });

  it("no duplicate aliases across entries", () => {
    const seen = new Set<string>();
    for (const entry of SKILLS_GAZETTEER) {
      for (const alias of entry.aliases) {
        expect(seen.has(alias), `duplicate alias: ${alias}`).toBe(false);
        seen.add(alias);
      }
    }
  });

  it("covers at least 200 distinct skills (coverage floor)", () => {
    expect(SKILLS_GAZETTEER.length).toBeGreaterThanOrEqual(200);
  });
});

describe("extractSkills", () => {
  it("returns empty set for empty input", () => {
    expect(extractSkills("")).toEqual(new Set());
  });

  it("extracts a single skill from text", () => {
    expect(extractSkills("Strong React experience required")).toEqual(
      new Set(["React"]),
    );
  });

  it("extracts multiple skills", () => {
    const result = extractSkills(
      "We use React, TypeScript, and Node.js in production",
    );
    expect(result).toEqual(new Set(["React", "TypeScript", "Node.js"]));
  });

  it("is case-insensitive", () => {
    expect(extractSkills("REACT developer")).toEqual(new Set(["React"]));
    expect(extractSkills("typescript engineer")).toEqual(
      new Set(["TypeScript"]),
    );
  });

  it("normalizes aliases to canonical name", () => {
    expect(extractSkills("React.js and ReactJS are the same")).toEqual(
      new Set(["React"]),
    );
    expect(extractSkills("nodejs and Node.js")).toEqual(new Set(["Node.js"]));
  });

  it("deduplicates repeated mentions", () => {
    expect(extractSkills("Python python PYTHON python3")).toEqual(
      new Set(["Python"]),
    );
  });

  it("respects word boundaries (does not match substrings)", () => {
    // "go" should NOT match inside "google"
    expect(extractSkills("I work at google")).not.toContain("Go");
    // "java" should NOT match inside "javascript"
    const jsOnly = extractSkills("javascript only");
    expect(jsOnly.has("JavaScript")).toBe(true);
    expect(jsOnly.has("Java")).toBe(false);
  });

  it("handles punctuation and whitespace correctly", () => {
    const result = extractSkills(
      "Skills: React, TypeScript; experience with Docker/Kubernetes.",
    );
    expect(result).toEqual(
      new Set(["React", "TypeScript", "Docker", "Kubernetes"]),
    );
  });

  it("matches punctuation-heavy names without leaking into substrings", () => {
    expect(extractSkills("Required: C++, C#, .NET 8 and ASP.NET Core")).toEqual(
      new Set(["C++", "C#", ".NET", "ASP.NET"]),
    );
    expect(extractSkills("Google engineering")).not.toContain("Go");
    expect(extractSkills("Go engineering")).toContain("Go");
  });

  it("requires technical context for ambiguous Go and Spring words", () => {
    expect(
      extractSkills(
        "Candidates must go onsite this spring for the Spring 2026 graduate program.",
      ),
    ).not.toContain("Go");
    expect(
      extractSkills(
        "Candidates must go onsite this spring for the Spring 2026 graduate program.",
      ),
    ).not.toContain("Spring");
    expect(
      extractSkills("Prior experience in spring internships is welcome."),
    ).not.toContain("Spring");

    expect(
      extractSkills(
        "Experience with Go programming and Java/Spring MVC services.",
      ),
    ).toEqual(new Set(["Go", "Java", "Spring"]));
  });

  it("keeps compound framework names distinct", () => {
    expect(extractSkills("React Native mobile delivery")).toEqual(
      new Set(["React Native"]),
    );
    expect(extractSkills("Spring Boot APIs")).toEqual(
      new Set(["Spring Boot"]),
    );
  });

  it("recognises managed-cloud service aliases", () => {
    expect(
      extractSkills("Operate EKS, EC2, RDS, S3 and CloudFormation on AWS"),
    ).toEqual(
      new Set([
        "Amazon EKS",
        "Amazon EC2",
        "Amazon RDS",
        "Amazon S3",
        "CloudFormation",
        "AWS",
      ]),
    );
  });

  it("matches longer aliases before shorter ones (e.g. Node.js before node)", () => {
    // Only Node.js entry has these aliases; there's no separate "Node" entry.
    // This asserts that "Node.js" phrase gets picked up instead of silently
    // failing due to the "." in the alias.
    expect(extractSkills("Node.js backend")).toEqual(new Set(["Node.js"]));
  });

  it("treats multiple calls independently (regex state reset)", () => {
    const first = extractSkills("React developer");
    const second = extractSkills("Python engineer");
    expect(first).toEqual(new Set(["React"]));
    expect(second).toEqual(new Set(["Python"]));
  });

  it("returns source positions and expands only safe one-way implications", () => {
    const mentions = extractSkillMentions("Ship services on EKS with TypeScript");
    expect(mentions.map((mention) => mention.name)).toEqual([
      "Amazon EKS",
      "TypeScript",
    ]);
    expect(mentions[0]?.index).toBe(17);

    const expanded = expandSkillSet(mentions.map((mention) => mention.name));
    expect(expanded).toEqual(
      new Set(["Amazon EKS", "TypeScript", "Kubernetes", "AWS", "JavaScript"]),
    );
    expect(expandSkillSet(["Kubernetes"])).not.toContain("Amazon EKS");
  });

  it("extracts skills from a realistic JD paragraph", () => {
    const jd = `
      We're looking for a Senior Backend Engineer to join our platform team.
      Requirements: 5+ years with Java and Spring Boot, hands-on experience
      with Kubernetes, Docker, PostgreSQL, Redis, and Kafka. Bonus: Terraform
      and AWS (Lambda, SQS). Familiar with gRPC and REST APIs. Git for version
      control.
    `;
    const result = extractSkills(jd);
    expect(result.has("Java")).toBe(true);
    expect(result.has("Spring Boot")).toBe(true);
    expect(result.has("Kubernetes")).toBe(true);
    expect(result.has("Docker")).toBe(true);
    expect(result.has("PostgreSQL")).toBe(true);
    expect(result.has("Redis")).toBe(true);
    expect(result.has("Kafka")).toBe(true);
    expect(result.has("Terraform")).toBe(true);
    expect(result.has("AWS")).toBe(true);
    expect(result.has("Lambda")).toBe(true);
    expect(result.has("SQS")).toBe(true);
    expect(result.has("gRPC")).toBe(true);
    expect(result.has("REST")).toBe(true);
    expect(result.has("Git")).toBe(true);
  });
});

describe("skill categories", () => {
  it("assigns a category to every gazetteer entry", () => {
    // The categories come from this file's own section headings, so a new
    // entry added outside a section would silently lose its colour.
    for (const entry of SKILLS_GAZETTEER) {
      expect(
        SKILL_CATEGORIES,
        `${entry.name} has category ${entry.category}`,
      ).toContain(entry.category);
    }
  });

  it("resolves the family of a canonical skill", () => {
    expect(categoryForSkill("Java")).toBe("LANGUAGE");
    expect(categoryForSkill("Kotlin")).toBe("LANGUAGE");
    expect(categoryForSkill("Spring Boot")).toBe("FRAMEWORK");
    expect(categoryForSkill("PostgreSQL")).toBe("DATA");
    expect(categoryForSkill("Kubernetes")).toBe("PLATFORM");
  });

  it("returns null outside the gazetteer rather than guessing", () => {
    // The JD analyser surfaces context-inferred skills too; a wrong colour is
    // worse than no colour.
    expect(categoryForSkill("Event-driven architecture at Acme")).toBeNull();
    expect(categoryForSkill("")).toBeNull();
  });
});
