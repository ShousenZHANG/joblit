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
});
