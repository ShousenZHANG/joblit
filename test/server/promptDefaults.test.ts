import { describe, expect, it } from "vitest";

import { DEFAULT_COVER_RULES, DEFAULT_CV_RULES } from "@/lib/shared/aiPromptDefaults";
import { DEFAULT_RULES } from "@/lib/server/ai/promptSkills";
import { buildTailorPrompts } from "@/lib/server/ai/buildPrompt";

describe("default prompt rules", () => {
  it("includes recruiter-level and XYZ bullet guidance in CV rules", () => {
    const cvText = DEFAULT_CV_RULES.join("\n").toLowerCase();
    expect(cvText).toContain("faang senior technical recruiter");
    expect(cvText).toContain("google xyz");
  });

  it("enforces recruiter-preferred cover alignment, bold strategy, and natural professional tone", () => {
    const coverText = DEFAULT_COVER_RULES.join("\n").toLowerCase();
    expect(coverText).toContain("top-3 jd responsibilities");
    expect(coverText).toContain("bold");
    expect(coverText).toContain("jd-critical keywords");
    expect(coverText).toContain("professional");
    expect(coverText).toContain("natural");
    expect(coverText).toMatch(/australian|understated|evidence-first|scannable/);
  });

  it("uses recruiter role in system prompt", () => {
    const prompts = buildTailorPrompts(DEFAULT_RULES, {
      baseSummary: "Base summary",
      jobTitle: "Software Engineer",
      company: "Example Co",
      description: "Build product features.",
    });
    expect(prompts.systemPrompt.toLowerCase()).toContain("senior recruiter-level");
  });

  it("allows markdown bold markers inside JSON string values for cv summary keyword emphasis", () => {
    const prompts = buildTailorPrompts(DEFAULT_RULES, {
      baseSummary: "Base summary",
      jobTitle: "Software Engineer",
      company: "Example Co",
      description: "Build product features.",
    });
    const text = `${prompts.systemPrompt}\n${prompts.userPrompt}`;
    expect(text).toContain("Markdown bold markers inside JSON string values are allowed when explicitly requested.");
    expect(text).toContain("In cvSummary, bold JD-critical keywords using clean markdown **keyword** markers.");
  });

  it("includes cover evidence pack sections when resume context is provided", () => {
    const prompts = buildTailorPrompts(DEFAULT_RULES, {
      baseSummary: "Built backend services for fintech platforms.",
      jobTitle: "Software Engineer",
      company: "Example Co",
      description: "Design APIs and maintain cloud deployment pipelines.",
      coverContext: {
        topResponsibilities: ["Design APIs", "Maintain cloud deployment pipelines"],
        matchedEvidence: ["Experience (Backend Engineer @ Acme): Built Java APIs and CI/CD pipelines."],
        resumeHighlights: ["Cloud: AWS", "Cloud: Docker"],
      },
    });
    expect(prompts.userPrompt).toContain("Top JD responsibilities (priority order):");
    expect(prompts.userPrompt).toContain("Matched resume evidence (highest relevance):");
    expect(prompts.userPrompt).toContain("Additional resume highlights:");
    expect(prompts.userPrompt).toContain("Experience (Backend Engineer @ Acme):");
  });
});
