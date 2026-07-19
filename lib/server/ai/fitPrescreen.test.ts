import { describe, expect, it } from "vitest";

import { prescreenJobFit } from "./fitPrescreen";

const RESUME_TEXT =
  "Senior engineer with TypeScript, React, Next.js, Node.js, PostgreSQL, and AWS experience.";

describe("deterministic fit prescreen", () => {
  it("marks an obvious mismatch POOR without an AI run", () => {
    const outcome = prescreenJobFit({
      jobDescription:
        "Requires deep Java, Spring Boot, Kafka, Scala, Hibernate, Kubernetes, Terraform and Jenkins experience.",
      resumeText: RESUME_TEXT,
    });
    expect(outcome.decision).toBe("poor");
    if (outcome.decision === "poor") {
      expect(outcome.result.score).toBeLessThan(25);
      expect(outcome.result.verdict).toBe("POOR");
      expect(outcome.result.criticalSkills).toContain("Java");
      expect(outcome.result.missingSkills).toContain("Spring Boot");
    }
  });

  it("sends overlapping roles to the AI matrix", () => {
    const outcome = prescreenJobFit({
      jobDescription:
        "We need TypeScript, React, Node.js, PostgreSQL and AWS for a product team.",
      resumeText: RESUME_TEXT,
    });
    expect(outcome.decision).toBe("score_with_ai");
  });

  it("never prescreens when the JD is empty or unreadable by the gazetteer", () => {
    expect(
      prescreenJobFit({ jobDescription: "", resumeText: RESUME_TEXT }).decision,
    ).toBe("score_with_ai");
    expect(
      prescreenJobFit({
        jobDescription: "A wonderful opportunity to join a dynamic team.",
        resumeText: RESUME_TEXT,
      }).decision,
    ).toBe("score_with_ai");
  });

  it("does not dilute core fit with benefits or optional technology", () => {
    const outcome = prescreenJobFit({
      jobDescription: `
        Requirements:
        Build services with TypeScript, Node.js and PostgreSQL.
        Nice to have:
        Java, Spring Boot, Scala, Kafka, Terraform and Jenkins.
        Benefits:
        AWS credits, Kubernetes training and GitHub access.
      `,
      resumeText: RESUME_TEXT,
    });
    expect(outcome.decision).toBe("score_with_ai");
  });

  it("uses safe framework implications for candidate evidence", () => {
    const outcome = prescreenJobFit({
      jobDescription:
        "Must have JavaScript, React, Kubernetes, AWS and PostgreSQL experience.",
      resumeText:
        "Delivered TypeScript, React Native, Amazon EKS and PostgreSQL systems.",
    });
    expect(outcome.decision).toBe("score_with_ai");
  });

  it("does not auto-reject on fewer than three decisive technical requirements", () => {
    const outcome = prescreenJobFit({
      jobDescription: "Must have Java and Spring Boot experience.",
      resumeText: RESUME_TEXT,
    });
    expect(outcome.decision).toBe("score_with_ai");
  });
});
