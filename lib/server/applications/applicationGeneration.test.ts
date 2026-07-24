import { describe, expect, it } from "vitest";

import { acceptApplicationGeneration } from "./applicationGeneration";

const master = {
  candidate: {
    name: "Jane Doe",
    title: "Software Engineer",
    phone: "+61 400 000 000",
    email: "jane@example.com",
    linkedinUrl: "https://linkedin.com/in/jane",
    linkedinText: "linkedin.com/in/jane",
    githubUrl: undefined,
    githubText: undefined,
    websiteUrl: undefined,
    websiteText: undefined,
  },
  summary: "Base summary",
  skills: [{ label: "Backend", items: ["Java"] }],
  experiences: [
    {
      title: "Engineer",
      company: "Acme",
      location: "Sydney",
      dates: "2022-2024",
      bullets: ["Built Java APIs.", "Maintained CI/CD pipelines on Linux."],
      links: [],
    },
  ],
  projects: [],
  education: [],
};

const profile = {
  basics: { fullName: "Jane Doe", title: "Engineer" },
  summary: "Delivered Java services and Linux CI/CD improvements.",
  experiences: [
    {
      title: "Engineer",
      company: "Acme",
      bullets: ["Built Java APIs.", "Maintained CI/CD pipelines on Linux."],
    },
  ],
  skills: [{ label: "Backend", items: ["Java"] }],
};

const job = {
  title: "Software Engineer",
  company: "Example Co",
  description: "Build Java APIs and improve Linux CI/CD delivery.",
};

describe("acceptApplicationGeneration", () => {
  it("does not invent target provenance when a legacy manual receipt is unknown", () => {
    const result = acceptApplicationGeneration({
      evidenceScopeKey: "user-1",
      target: "resume",
      source: "manual_import",
      rawOutput: JSON.stringify({
        cvSummary: "Focused on Java services.",
        latestExperience: { addedBullets: [] },
      }),
      promptMetaHash: "",
      master,
      profile,
      job,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.aiContent.promptMetaHash).toBe("");
    expect(result.aiContent.provenance).toBeUndefined();
  });

  it("normalizes a v1 manual resume into canonical AI-added bullets and ignores skills", () => {
    const result = acceptApplicationGeneration({
      evidenceScopeKey: "user-1",
      target: "resume",
      source: "manual_import",
      rawOutput: JSON.stringify({
        cvSummary: "Focused on Java services and reliable delivery.",
        latestExperience: {
          bullets: [
            "Maintained CI/CD pipelines on Linux.",
            "Built Java APIs.",
            "Automated Java APIs delivery for production services.",
          ],
        },
        skillsFinal: [{ label: "Injected", items: ["Unpersisted skill"] }],
      }),
      promptMetaHash: "prompt-hash",
      master,
      profile,
      job,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inputFormat).toBe("v1_compat");
    expect(result.aiContent.cv.latestExperience.addedBullets).toEqual([
      expect.objectContaining({
        text: "Automated Java APIs delivery for production services.",
        accepted: true,
        qualityGate: { passed: true },
      }),
    ]);
    expect(result.aiContent.cv).not.toHaveProperty("skillsFinal");
    expect(result.aiContent.provenance).toEqual({
      resume: {
        generatedAt: result.aiContent.generatedAt,
        promptMetaHash: "prompt-hash",
        source: "manual_import",
      },
    });
  });

  it("accepts only canonical Cover paragraphs from local AI", () => {
    const result = acceptApplicationGeneration({
      evidenceScopeKey: "user-1",
      target: "cover",
      source: "local_ai",
      rawOutput: JSON.stringify({
        cover: {
          paragraphOne: "I build grounded Java services.",
          paragraphTwo: "My API and Linux delivery work maps to this role.",
          paragraphThree: "The engineering remit is a strong next step.",
        },
      }),
      promptMetaHash: "local-prompt-hash",
      master,
      profile,
      job,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inputFormat).toBe("current");
    expect(result.aiContent.cover).toEqual({
      paragraphOne: expect.objectContaining({
        aiText: "I build grounded Java services.",
        accepted: true,
      }),
      paragraphTwo: expect.objectContaining({
        aiText: "My API and Linux delivery work maps to this role.",
        accepted: true,
      }),
      paragraphThree: expect.objectContaining({
        aiText: "The engineering remit is a strong next step.",
        accepted: true,
      }),
    });
    expect(result.aiContent.provenance).toEqual({
      cover: {
        generatedAt: result.aiContent.generatedAt,
        promptMetaHash: "local-prompt-hash",
        source: "local_ai",
      },
    });
  });

  it("rejects the v1 full-bullet contract from local AI", () => {
    const result = acceptApplicationGeneration({
      evidenceScopeKey: "user-1",
      target: "resume",
      source: "local_ai",
      rawOutput: JSON.stringify({
        cvSummary: "Focused on Java services.",
        latestExperience: {
          bullets: ["Built Java APIs.", "Maintained CI/CD pipelines on Linux."],
        },
        skillsFinal: [{ label: "Backend", items: ["Java"] }],
      }),
      promptMetaHash: "local-prompt-hash",
      master,
      profile,
      job,
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "INVALID_AI_RESULT" }),
      }),
    );
  });

  it("accepts the strict current Resume contract for an internal provider", () => {
    const result = acceptApplicationGeneration({
      evidenceScopeKey: "user-1",
      target: "resume",
      source: "server_batch",
      rawOutput: JSON.stringify({
        cvSummary: "Focused on Java services.",
        latestExperience: { addedBullets: [] },
      }),
      promptMetaHash: "server-prompt-hash",
      master,
      profile,
      job,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inputFormat).toBe("current");
    expect(result.aiContent.source).toBeUndefined();
    expect(result.aiContent.provenance?.resume).toEqual({
      generatedAt: result.aiContent.generatedAt,
      promptMetaHash: "server-prompt-hash",
      source: "server_batch",
    });
  });

  it("grounds additions against project and skill evidence across the Master Resume Profile", () => {
    const result = acceptApplicationGeneration({
      evidenceScopeKey: "user-1",
      target: "resume",
      source: "server_batch",
      rawOutput: JSON.stringify({
        cvSummary: "Platform engineer focused on grounded delivery.",
        latestExperience: {
          addedBullets: [
            "Automated **TypeScript** deployments on **AWS** for reliable releases.",
            "Implemented **Docker** and **Kubernetes** delivery workflows.",
          ],
        },
      }),
      promptMetaHash: "server-prompt-hash",
      master,
      profile: {
        ...profile,
        skills: [
          { label: "Cloud", items: ["Docker", "Kubernetes"] },
        ],
        projects: [
          {
            name: "Delivery platform",
            stack: "TypeScript, AWS",
            bullets: [
              "Built TypeScript deployment automation on AWS.",
            ],
          },
        ],
      },
      job,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.aiContent.cv.latestExperience.addedBullets).toEqual([
      expect.objectContaining({
        accepted: true,
        qualityGate: { passed: true },
      }),
      expect.objectContaining({
        accepted: true,
        qualityGate: { passed: true },
      }),
    ]);
  });

  it("reads legacy Cover headers from a manual import but keeps only canonical paragraphs", () => {
    const result = acceptApplicationGeneration({
      evidenceScopeKey: "user-1",
      target: "cover",
      source: "manual_import",
      rawOutput: JSON.stringify({
        cover: {
          candidateTitle: "Injected title",
          subject: "Injected subject",
          date: "1 January 2030",
          salutation: "Injected salutation",
          paragraphOne: "One",
          paragraphTwo: "Two",
          paragraphThree: "Three",
          closing: "Injected closing",
          signatureName: "Injected name",
        },
      }),
      promptMetaHash: "manual-prompt-hash",
      master,
      profile,
      job,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.aiContent.cover).toEqual({
      paragraphOne: expect.objectContaining({ aiText: "One" }),
      paragraphTwo: expect.objectContaining({ aiText: "Two" }),
      paragraphThree: expect.objectContaining({ aiText: "Three" }),
    });
    expect(JSON.stringify(result.aiContent)).not.toContain("Injected");
  });
});
