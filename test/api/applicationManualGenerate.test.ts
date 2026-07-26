import { beforeEach, describe, expect, it, vi } from "vitest";

const jobStore = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

const applicationStore = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

const evidenceStore = vi.hoisted(() => ({
  evidenceCreateMany: vi.fn(),
  claimCreateMany: vi.fn(),
}));

const atsStore = vi.hoisted(() => ({
  assertAtsPdf: vi.fn(),
}));

const blobStore = vi.hoisted(() => ({
  put: vi.fn(),
  del: vi.fn(),
}));

const transactionStore = vi.hoisted(() => ({
  run: vi.fn(),
  executeRaw: vi.fn(),
}));

const rateLimitStore = vi.hoisted(() => ({
  enforce: vi.fn(() => null),
}));

const applicationPrompt = vi.hoisted(() => ({
  buildApplicationPromptForUser: vi.fn(async () => ({
    promptMeta: {
      ruleSetId: "rules-1",
      resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
      promptTemplateVersion: "2026.07.v2",
      schemaVersion: "2026-07-24",
      skillPackVersion: "b".repeat(64),
      promptHash: "c".repeat(64),
    },
    snapshotBinding: {
      resumeProfileId: "660e8400-e29b-41d4-a716-446655440000",
      resumeSnapshotHash: "d".repeat(64),
      jobSnapshotHash: "e".repeat(64),
    },
  })),
}));

const tailoringAcceptance = vi.hoisted(() => ({
  hashManualTailoringAcceptance: vi.fn(() => "request-hash"),
  probeTailoringRunAcceptanceReplay: vi.fn(
    async (): Promise<unknown> => null,
  ),
  prepareTailoringRunAcceptance: vi.fn(async (_tx, input) => ({
    userId: input.userId,
    pending: input.requests,
    replayed: [],
    runs: [],
  })),
  completeTailoringRunAcceptance: vi.fn(async () => ({
    receipts: [],
    completedRunIds: [],
  })),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    job: jobStore,
    application: applicationStore,
    $transaction: transactionStore.run,
  },
}));

vi.mock("@vercel/blob", () => ({
  put: blobStore.put,
  del: blobStore.del,
}));

vi.mock("@/lib/server/applications/atsPdfValidator", () => ({
  AtsPdfValidationError: class AtsPdfValidationError extends Error {
    code = "ATS_PDF_VALIDATION_FAILED";
    status = 422;
    constructor(public report: unknown) {
      super("ATS validation failed");
    }
  },
  assertAtsPdf: atsStore.assertAtsPdf,
}));

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/server/api/aiRateLimit", () => ({
  enforceAiRateLimit: rateLimitStore.enforce,
}));

vi.mock("@/lib/server/resumeProfile", () => ({
  getResumeProfile: vi.fn(),
}));

vi.mock("@/lib/server/applications/applicationPrompt", () => ({
  ApplicationPromptError: class ApplicationPromptError extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
      public details?: unknown,
    ) {
      super(message);
    }
  },
  buildApplicationPromptForUser:
    applicationPrompt.buildApplicationPromptForUser,
}));

vi.mock("@/lib/server/tailoringRuns/tailoringRunAcceptance", () => tailoringAcceptance);

vi.mock("@/lib/server/latex/mapResumeProfile", () => ({
  mapResumeProfile: vi.fn(() => ({
    candidate: {
      name: "Jane Doe",
      title: "Software Engineer",
      email: "jane@example.com",
      phone: "+1 555 0100",
      linkedinUrl: "https://linkedin.com/in/jane",
      linkedinText: "linkedin.com/in/jane",
    },
    summary: "Base summary",
    skills: [],
    experiences: [],
    projects: [],
    education: [],
  })),
}));

vi.mock("@/lib/server/latex/renderResume", () => ({
  renderResumeTex: vi.fn(() => "\\documentclass{article}"),
}));

vi.mock("@/lib/server/latex/renderCoverLetter", () => ({
  renderCoverLetterTex: vi.fn(() => "\\documentclass{article}"),
}));

vi.mock("@/lib/server/latex/compilePdf", () => ({
  LatexRenderError: class LatexRenderError extends Error {
    constructor(
      public code: string,
      public status: number,
      message: string,
      public details?: unknown,
    ) {
      super(message);
    }
  },
  compileLatexToPdf: vi.fn(async () => Buffer.from([37, 80, 68, 70])),
}));

vi.mock("@/lib/server/promptRuleTemplates", () => ({
  getActivePromptSkillRulesForUser: vi.fn(async () => ({
    id: "rules-1",
    locale: "en-AU",
    cvRules: ["cv-rule"],
    coverRules: ["cover-rule"],
    hardConstraints: ["json-only"],
  })),
}));

import { getServerSession } from "next-auth/next";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import { renderResumeTex } from "@/lib/server/latex/renderResume";
import { renderCoverLetterTex } from "@/lib/server/latex/renderCoverLetter";
import { compileLatexToPdf } from "@/lib/server/latex/compilePdf";
import { TailoringRunError } from "@/lib/server/tailoringRuns/tailoringRunProtocol";
import { POST } from "@/app/api/applications/manual-generate/route";

const VALID_JOB_ID = "550e8400-e29b-41d4-a716-446655440000";
const TAILORING_RUN_ID = "770e8400-e29b-41d4-a716-446655440000";
const TAILORING_ATTEMPT_ID = "880e8400-e29b-41d4-a716-446655440000";
const VALID_OUTPUT = JSON.stringify({
  cvSummary: "Tailored summary",
  latestExperience: {
    bullets: ["base bullet one"],
  },
  cover: {
    paragraphOne: "One",
    paragraphTwo: "Two",
    paragraphThree: "Three",
  },
});

function makeExistingAiContent() {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-19T00:00:00.000Z",
    promptMetaHash: "existing-prompt",
    source: "local_ai",
    cv: {
      summary: {
        aiText: "Existing CV summary",
        originalText: "Base summary",
        accepted: true,
      },
      latestExperience: {
        experienceIndex: 0,
        addedBullets: [
          {
            text: "Existing CV bullet",
            accepted: true,
            qualityGate: { passed: true },
          },
        ],
      },
    },
    cover: {
      paragraphOne: { aiText: "Existing cover one", accepted: true },
      paragraphTwo: { aiText: "Existing cover two", accepted: true },
      paragraphThree: { aiText: "Existing cover three", accepted: true },
    },
  } as const;
}

describe("applications manual generate api", () => {
  beforeEach(() => {
    applicationPrompt.buildApplicationPromptForUser.mockReset().mockResolvedValue({
      promptMeta: {
        ruleSetId: "rules-1",
        resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
        promptTemplateVersion: "2026.07.v2",
        schemaVersion: "2026-07-24",
        skillPackVersion: "b".repeat(64),
        promptHash: "c".repeat(64),
      },
      snapshotBinding: {
        resumeProfileId: "660e8400-e29b-41d4-a716-446655440000",
        resumeSnapshotHash: "d".repeat(64),
        jobSnapshotHash: "e".repeat(64),
      },
    });
    tailoringAcceptance.hashManualTailoringAcceptance.mockClear();
    tailoringAcceptance.probeTailoringRunAcceptanceReplay
      .mockReset()
      .mockResolvedValue(null);
    tailoringAcceptance.prepareTailoringRunAcceptance.mockClear();
    tailoringAcceptance.completeTailoringRunAcceptance.mockClear();
    rateLimitStore.enforce.mockReset().mockReturnValue(null);
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockReset();
    (mapResumeProfile as unknown as ReturnType<typeof vi.fn>).mockReset();
    (renderResumeTex as unknown as ReturnType<typeof vi.fn>).mockReset();
    (renderCoverLetterTex as unknown as ReturnType<typeof vi.fn>).mockReset();
    (compileLatexToPdf as unknown as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue(Buffer.from([37, 80, 68, 70]));
    (mapResumeProfile as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      candidate: {
        name: "Jane Doe",
        title: "Software Engineer",
        email: "jane@example.com",
        phone: "+1 555 0100",
        linkedinUrl: "https://linkedin.com/in/jane",
        linkedinText: "linkedin.com/in/jane",
      },
      summary: "Base summary",
      skills: [],
      experiences: [],
      projects: [],
      education: [],
    });
    (renderResumeTex as unknown as ReturnType<typeof vi.fn>).mockReturnValue("\\documentclass{article}");
    (renderCoverLetterTex as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      "\\documentclass{article}",
    );
    jobStore.findFirst.mockReset();
    // Each test seeds the route's own lookup with mockResolvedValueOnce; this
    // default answers the ownership re-check commitApplicationArtifact makes
    // under the lock.
    jobStore.findFirst.mockResolvedValue({ id: VALID_JOB_ID });
    applicationStore.findUnique.mockReset();
    applicationStore.upsert.mockReset();
    blobStore.put.mockReset();
    blobStore.del.mockReset();
    blobStore.del.mockResolvedValue(undefined);
    transactionStore.executeRaw.mockReset();
    transactionStore.executeRaw.mockResolvedValue(1);
    transactionStore.run.mockReset();
    transactionStore.run.mockImplementation(
      async (
        callback: (tx: {
          job: typeof jobStore;
          application: typeof applicationStore;
          evidenceSnapshot: { createMany: typeof evidenceStore.evidenceCreateMany };
          claimEvidence: { createMany: typeof evidenceStore.claimCreateMany };
          $executeRaw: typeof transactionStore.executeRaw;
        }) => unknown,
      ) =>
        callback({
          // commitApplicationArtifact re-checks Job ownership under the lock,
          // so a delete racing the render is reported rather than surfacing as
          // a foreign-key violation.
          job: jobStore,
          application: applicationStore,
          evidenceSnapshot: { createMany: evidenceStore.evidenceCreateMany },
          claimEvidence: { createMany: evidenceStore.claimCreateMany },
          $executeRaw: transactionStore.executeRaw,
        }),
    );
    delete process.env.BLOB_READ_WRITE_TOKEN;
    applicationStore.findUnique.mockResolvedValue(null);
    evidenceStore.evidenceCreateMany.mockReset().mockResolvedValue({ count: 1 });
    evidenceStore.claimCreateMany.mockReset().mockResolvedValue({ count: 1 });
    atsStore.assertAtsPdf.mockReset().mockResolvedValue({
      passed: true,
      pageCount: 1,
      textLength: 400,
      keywordCoverage: 100,
      matchedKeywords: [],
      missingKeywords: [],
      errors: [],
      warnings: [],
    });
  });

  it("returns parse error for invalid model output", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });

    const res = await POST(
      new Request("http://localhost/api/applications/manual-generate", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput: "invalid-output-invalid-output",
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
            promptTemplateVersion: "2026.07.v2",
            schemaVersion: "2026-07-24",
            skillPackVersion: "b".repeat(64),
            promptHash: "c".repeat(64),
          },
        }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("PARSE_FAILED");
  });

  it("keeps legacy manual imports compatible when promptMeta is omitted", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      location: "Sydney",
      description: "Build product features",
      market: "AU",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    const res = await POST(
      new Request("http://localhost/api/applications/manual-generate?finalize=false", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput: VALID_OUTPUT,
        }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.aiContent.promptMetaHash).toBe("");
    expect(json.aiContent.source).toBe("manual_import");
    expect(json.aiContent.provenance).toBeUndefined();
  });

  it("does not attribute a partial legacy receipt to the current exact prompt", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      location: "Sydney",
      description: "Build product features",
      market: "AU",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    const res = await POST(
      new Request("http://localhost/api/applications/manual-generate?finalize=false", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput: VALID_OUTPUT,
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
          },
        }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.aiContent.promptMetaHash).toBe("");
    expect(json.aiContent.provenance).toBeUndefined();
  });

  it("generates resume pdf from imported JSON", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    const res = await POST(
      new Request("http://localhost/api/applications/manual-generate", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput: VALID_OUTPUT,
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
            promptTemplateVersion: "2026.07.v2",
            schemaVersion: "2026-07-24",
            skillPackVersion: "b".repeat(64),
            promptHash: "c".repeat(64),
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-tailor-cv-source")).toBe("manual_import");
  });

  it("accepts resume JSON when model output includes commentary and trailing brace text", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    const noisyOutput = [
      "Sure - generated output below:",
      "```json",
      "{",
      '  "cvSummary": "Tailored summary",',
      '  "latestExperience": { "bullets": ["base bullet one"] }',
      "}",
      "```",
      "Validation note: {format: ok}",
    ].join("\n");

    const res = await POST(
      new Request("http://localhost/api/applications/manual-generate", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput: noisyOutput,
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });

  it("preserves Master Profile bullets and skills for the resume target", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
      skills: [
        { label: "Backend", items: ["Java", "Spring Boot"] },
        { label: "Cloud", items: ["GCP"] },
      ],
    });
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    (mapResumeProfile as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      candidate: {
        name: "Jane Doe",
        title: "Software Engineer",
        email: "jane@example.com",
        phone: "+1 555 0100",
      },
      summary: "Base summary",
      skills: [{ label: "Backend", items: ["Java"] }],
      experiences: [
        {
          location: "Sydney, AU",
          dates: "2022-2023",
          title: "Engineer",
          company: "Example",
          bullets: ["Built Java services for internal APIs.", "Maintained CI/CD pipelines on Linux."],
        },
      ],
      projects: [],
      education: [],
    });

    const resumePatch = JSON.stringify({
      cvSummary: "Tailored summary",
      latestExperience: {
        bullets: [
          "Maintained CI/CD pipelines on Linux.",
          "Built Java services for internal APIs.",
          "Built internal developer tooling that reduced rollback risk across Linux service deployments.",
        ],
      },
      skillsFinal: [
        { label: "Backend", items: ["Java", "Spring Boot"] },
        { label: "Cloud", items: ["GCP"] },
      ],
    });

    const res = await POST(
      new Request("http://localhost/api/applications/manual-generate", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput: resumePatch,
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    const renderCallArg = (renderResumeTex as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(renderCallArg.summary).toBe("Tailored summary");
    expect(renderCallArg.experiences[0].bullets).toEqual([
      "Built Java services for internal APIs.",
      "Maintained CI/CD pipelines on Linux.",
    ]);
    expect(renderCallArg.skills).toEqual([
      { label: "Backend", items: ["Java"] },
    ]);
  });

  it("allows resume import even when top responsibilities are not fully covered", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Design and build scalable backend services and CI/CD pipelines for cloud platform delivery.",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    (mapResumeProfile as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      candidate: {
        name: "Jane Doe",
        title: "Software Engineer",
        email: "jane@example.com",
        phone: "+1 555 0100",
      },
      summary: "Base summary",
      skills: [],
      experiences: [
        {
          location: "Sydney, AU",
          dates: "2022-2023",
          title: "Engineer",
          company: "Example",
          bullets: ["old-1", "old-2"],
        },
      ],
      projects: [],
      education: [],
    });

    const importedPatch = JSON.stringify({
      cvSummary: "Tailored summary",
      latestExperience: {
        bullets: ["old-1 rewritten", "old-2"],
      },
    });

    const res = await POST(
      new Request("http://localhost/api/applications/manual-generate", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput: importedPatch,
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });

  it("accepts markdown-only formatting differences in existing bullets", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    (mapResumeProfile as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      candidate: {
        name: "Jane Doe",
        title: "Software Engineer",
        email: "jane@example.com",
        phone: "+1 555 0100",
      },
      summary: "Base summary",
      skills: [],
      experiences: [
        {
          location: "Sydney, AU",
          dates: "2022-2023",
          title: "Engineer",
          company: "Example",
          bullets: ["Delivered repeatable releases with Docker and Linux CI/CD pipelines."],
        },
      ],
      projects: [],
      education: [],
    });

    const formattingOnlyPatch = JSON.stringify({
      cvSummary: "Tailored summary",
      latestExperience: {
        bullets: ["Delivered repeatable releases with **Docker **and **Linux** CI/CD pipelines."],
      },
    });

    const res = await POST(
      new Request("http://localhost/api/applications/manual-generate", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput: formattingOnlyPatch,
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });

  it("uses AI-provided markdown bold in summary and new bullets for latex rendering", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build Java services with CI/CD and Docker",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    (mapResumeProfile as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      candidate: {
        name: "Jane Doe",
        title: "Software Engineer",
        email: "jane@example.com",
        phone: "+1 555 0100",
      },
      summary: "Base summary",
      skills: [],
      experiences: [
        {
          location: "Sydney, AU",
          dates: "2022-2023",
          title: "Engineer",
          company: "Example",
          bullets: ["Maintained deployment pipelines for services."],
        },
      ],
      projects: [],
      education: [],
    });

    const patch = JSON.stringify({
      cvSummary: "Focused on **Java** delivery with reliable pipelines.",
      latestExperience: {
        bullets: [
          "Maintained deployment pipelines for services.",
          "Improved deployment pipelines for services with **Docker** rollback safety checks.",
        ],
      },
    });

    const res = await POST(
      new Request("http://localhost/api/applications/manual-generate", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput: patch,
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    const renderCallArg = (renderResumeTex as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(renderCallArg.summary).toContain("\\textbf{Java}");
    expect(renderCallArg.experiences[0].bullets[1]).toContain("\\textbf{Docker}");
  });

  it("drops ungrounded added latest-experience bullets that do not match base evidence", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
      experiences: [
        {
          title: "Engineer",
          company: "Example",
          bullets: ["Built Java APIs.", "Maintained CI/CD pipelines."],
        },
      ],
    });
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    (mapResumeProfile as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      candidate: {
        name: "Jane Doe",
        title: "Software Engineer",
        email: "jane@example.com",
        phone: "+1 555 0100",
      },
      summary: "Base summary",
      skills: [],
      experiences: [
        {
          location: "Sydney, AU",
          dates: "2022-2023",
          title: "Engineer",
          company: "Example",
          bullets: ["Built Java APIs.", "Maintained CI/CD pipelines."],
        },
      ],
      projects: [],
      education: [],
    });

    const patch = JSON.stringify({
      cvSummary: "Tailored summary",
      latestExperience: {
        bullets: [
          "Built Java APIs.",
          "Maintained CI/CD pipelines.",
          "Led M&A due diligence for Fortune 500 acquisitions.",
        ],
      },
    });

    const res = await POST(
      new Request("http://localhost/api/applications/manual-generate", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput: patch,
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    const renderCallArg = (renderResumeTex as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(renderCallArg.experiences[0].bullets).toEqual([
      "Built Java APIs.",
      "Maintained CI/CD pipelines.",
    ]);
  });

  it("drops redundant added latest-experience bullets that only repeat existing keywords", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
      experiences: [
        {
          title: "Engineer",
          company: "Example",
          bullets: ["Built Java APIs.", "Maintained CI/CD pipelines on Linux."],
        },
      ],
    });
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    (mapResumeProfile as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      candidate: {
        name: "Jane Doe",
        title: "Software Engineer",
        email: "jane@example.com",
        phone: "+1 555 0100",
      },
      summary: "Base summary",
      skills: [],
      experiences: [
        {
          location: "Sydney, AU",
          dates: "2022-2023",
          title: "Engineer",
          company: "Example",
          bullets: ["Built Java APIs.", "Maintained CI/CD pipelines on Linux."],
        },
      ],
      projects: [],
      education: [],
    });

    const patch = JSON.stringify({
      cvSummary: "Tailored summary",
      latestExperience: {
        bullets: [
          "Built Java APIs.",
          "Maintained CI/CD pipelines on Linux.",
          "Built Java APIs and maintained CI/CD pipelines on Linux.",
        ],
      },
    });

    const res = await POST(
      new Request("http://localhost/api/applications/manual-generate", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput: patch,
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    const renderCallArg = (renderResumeTex as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(renderCallArg.experiences[0].bullets).toEqual([
      "Built Java APIs.",
      "Maintained CI/CD pipelines on Linux.",
    ]);
  });

  it("returns 409 when prompt meta is stale", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-07T00:00:00.000Z"),
    });
    applicationPrompt.buildApplicationPromptForUser.mockResolvedValueOnce({
      promptMeta: {
        ruleSetId: "rules-1",
        resumeSnapshotUpdatedAt: "2026-02-07T00:00:00.000Z",
        promptTemplateVersion: "2026.07.v2",
        schemaVersion: "2026-07-24",
        skillPackVersion: "b".repeat(64),
        promptHash: "c".repeat(64),
      },
      snapshotBinding: {
        resumeProfileId: "rp-1",
        resumeSnapshotHash: "d".repeat(64),
        jobSnapshotHash: "e".repeat(64),
      },
    });

    const res = await POST(
      new Request("http://localhost/api/applications/manual-generate", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput: VALID_OUTPUT,
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
          },
        }),
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.error.code).toBe("PROMPT_META_MISMATCH");
  });

  it("returns 409 when prompt meta hash does not match current contract", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });

    const res = await POST(
      new Request("http://localhost/api/applications/manual-generate", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput: VALID_OUTPUT,
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
            promptTemplateVersion: "v999",
            schemaVersion: "v999",
            promptHash: "deadbeef",
          },
        }),
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.error.code).toBe("PROMPT_META_MISMATCH");
  });

  it("returns 409 when prompt meta skill pack version does not match current contract", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });

    const res = await POST(
      new Request("http://localhost/api/applications/manual-generate", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput: VALID_OUTPUT,
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
            skillPackVersion: "stale-pack",
          },
        }),
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.error.code).toBe("PROMPT_META_MISMATCH");
    expect(json.error.details.mismatches).toEqual([
      expect.objectContaining({ field: "skillPackVersion", received: "stale-pack" }),
    ]);
  });

  it("soft-fails quality gate but still generates manual cover pdf", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    const weakCoverOutput = JSON.stringify({
      cover: {
        paragraphOne: "One",
        paragraphTwo: "Two",
        paragraphThree: "Three",
      },
    });

    const res = await POST(
      new Request("http://localhost/api/applications/manual-generate", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "cover",
          modelOutput: weakCoverOutput,
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-cover-quality-gate")).toBe("soft-fail");
    expect(renderCoverLetterTex).toHaveBeenCalled();
  });

  it("generates cover pdf with cover letter suffix for high-quality cover target", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
      summary:
        "Delivered TypeScript and React product features with reliable CI/CD pipelines in production.",
      experiences: [
        {
          title: "Software Engineer",
          company: "Acme",
          bullets: [
            "Built TypeScript and React product features for customer workflows.",
            "Improved CI/CD reliability and reduced release risk.",
          ],
        },
      ],
    });
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    const highQualityCoverOutput = JSON.stringify({
      cover: {
        paragraphOne:
          "I am applying for the Software Engineer role at Example Co because the role aligns strongly with my recent delivery experience across **TypeScript**, **React**, and production quality. Over the past few years, I have shipped customer-facing web features in fast product cycles, translating vague requirements into clear milestones, implementing maintainable front-end and API changes, and partnering with design and QA to keep quality standards high. I bring a calm execution style, clear communication, and a bias for measurable outcomes in each release, including measurable adoption and reliability improvements after rollout.",
        paragraphTwo:
          "Your core expectation to build product features maps directly to my day-to-day work. I have built product features end to end, from scoping and technical breakdown through implementation, review, rollout, and monitoring. In my recent role, I delivered **TypeScript** and **React** improvements that simplified user journeys, reduced avoidable errors, and improved perceived responsiveness. I also strengthened **CI/CD** workflows by tightening checks before merge, improving release confidence, and making deployment behavior more predictable for the team. This combination of product focus and engineering discipline lets me deliver quickly without trading away maintainability, while still documenting decisions and supporting long-term team ownership.",
        paragraphThree:
          "What motivates me most about Example Co is the opportunity to contribute where product impact and engineering quality are both treated as first-class outcomes. I want to join a team where I can keep building useful product features, raise implementation standards, and support reliable delivery habits that scale as the roadmap grows. I am confident my background in practical delivery, cross-functional collaboration, and steady ownership would let me contribute early, and I would value the opportunity to discuss how I can support Example Co in this role with immediate, practical impact.",
      },
    });

    const res = await POST(
      new Request("http://localhost/api/applications/manual-generate", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "cover",
          modelOutput: highQualityCoverOutput,
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("_CL.pdf");
  });

  it("persists cover pdf url when blob token is configured", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });
    blobStore.put.mockResolvedValueOnce({
      url: "https://blob.vercel-storage.com/cover.pdf",
    });
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    const highQualityCoverOutput = JSON.stringify({
      cover: {
        paragraphOne: "I am applying for this role.",
        paragraphTwo: "My experience aligns with your key responsibilities.",
        paragraphThree: "I am motivated by your product impact.",
      },
    });

    const res = await POST(
      new Request("http://localhost/api/applications/manual-generate", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "cover",
          modelOutput: highQualityCoverOutput,
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(blobStore.put).toHaveBeenCalledTimes(1);
    expect(blobStore.put).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(
          `^applications/user-1/${VALID_JOB_ID}/cover\\.[0-9a-f]+-[0-9a-f-]{36}\\.pdf$`,
        ),
      ),
      expect.anything(),
      expect.objectContaining({
        allowOverwrite: true,
        addRandomSuffix: false,
        token: "blob-token",
      }),
    );
    expect(applicationStore.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          coverPdfUrl: "https://blob.vercel-storage.com/cover.pdf",
        }),
      }),
    );
  });

  it("?finalize=false skips PDF render and returns aiContent JSON for the editor", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
      market: "AU",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    const res = await POST(
      new Request("http://localhost/api/applications/manual-generate?finalize=false", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput: VALID_OUTPUT,
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const json = await res.json();
    expect(json.applicationId).toBe("app-1");
    expect(json.status).toBe("DRAFT");
    expect(typeof json.aiContentHash).toBe("string");
    expect(json.aiContent.cv.summary.aiText).toBe("Tailored summary");
    // DRAFT mode renders nothing, so the review dialog would otherwise have no
    // name for its object-URL download. A profile without basics degrades to
    // the job title alone rather than to "undefined".
    expect(json.pdfName).toBe("Software Engineer_CV.pdf");

    expect(applicationStore.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "DRAFT",
          aiContent: expect.objectContaining({
            cv: expect.any(Object),
            cover: expect.any(Object),
          }),
          aiContentHash: expect.any(String),
        }),
      }),
    );
    // PDF compile + Blob put are skipped in DRAFT mode.
    expect(blobStore.put).not.toHaveBeenCalled();
  });

  it("preserves an existing cover letter when importing a resume draft", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      location: "Sydney",
      description: "Build product features",
      market: "AU",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });
    const existing = makeExistingAiContent();
    applicationStore.findUnique.mockResolvedValueOnce({
      resumePdfUrl: null,
      coverPdfUrl: null,
      aiContent: existing,
    });
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    const res = await POST(
      new Request("http://localhost/api/applications/manual-generate?finalize=false", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput: VALID_OUTPUT,
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
          },
        }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.aiContent.cv.summary.aiText).toBe("Tailored summary");
    expect(json.aiContent.cover).toMatchObject(existing.cover);
    expect(json.aiContent.review).toBeDefined();
    expect(applicationStore.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          aiContent: expect.objectContaining({
            cover: expect.objectContaining({
              paragraphOne: expect.objectContaining({
                aiText: existing.cover.paragraphOne.aiText,
              }),
            }),
          }),
        }),
      }),
    );
  });

  it("preserves an existing CV when importing a cover-letter draft", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      location: "Sydney",
      description: "Build product features",
      market: "AU",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });
    const existing = makeExistingAiContent();
    applicationStore.findUnique.mockResolvedValueOnce({
      resumePdfUrl: null,
      coverPdfUrl: null,
      aiContent: existing,
    });
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    const res = await POST(
      new Request("http://localhost/api/applications/manual-generate?finalize=false", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "cover",
          modelOutput: JSON.stringify({
            cover: {
              paragraphOne: "New cover one",
              paragraphTwo: "New cover two",
              paragraphThree: "New cover three",
            },
          }),
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
          },
        }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.aiContent.cv).toMatchObject(existing.cv);
    expect(json.aiContent.cover.paragraphOne.aiText).toBe("New cover one");
    expect(json.aiContent.review).toBeDefined();
    expect(applicationStore.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          aiContent: expect.objectContaining({
            cv: expect.objectContaining({
              summary: expect.objectContaining({
                aiText: existing.cv.summary.aiText,
              }),
            }),
          }),
        }),
      }),
    );
  });

  it("fails closed when a single-target import encounters an unknown stored schema", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      location: "Sydney",
      description: "Build product features",
      market: "AU",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });
    applicationStore.findUnique.mockResolvedValueOnce({
      resumePdfUrl: null,
      coverPdfUrl: "https://blob.example/existing-cover.pdf",
      aiContent: {
        ...makeExistingAiContent(),
        schemaVersion: 999,
      },
      aiContentHash: null,
      atsValidation: null,
    });

    const response = await POST(
      new Request("http://localhost/api/applications/manual-generate?finalize=false", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput: VALID_OUTPUT,
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
          },
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error.code).toBe("AI_CONTENT_INVALID");
    expect(applicationStore.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ["fenced JSON", `\`\`\`json\n${JSON.stringify({ cvSummary: "Strict", latestExperience: { bullets: ["Built APIs."] }, skillsFinal: [{ label: "Backend", items: ["TypeScript"] }] })}\n\`\`\``],
    ["snake_case alias", JSON.stringify({ cv_summary: "Strict", latest_experience: { bullets: ["Built APIs."] } })],
    ["trailing comma", '{"cvSummary":"Strict","latestExperience":{"bullets":["Built APIs."]},}'],
    ["unknown key", JSON.stringify({ cvSummary: "Strict", latestExperience: { bullets: ["Built APIs."] }, unknown: true })],
  ])("returns stable INVALID_AI_RESULT for local AI %s", async (_label, modelOutput) => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "user-1" } });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      location: "Sydney",
      description: "Build product features",
      market: "AU",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });

    const res = await POST(new Request(
      "http://localhost/api/applications/manual-generate?finalize=false",
      {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput,
          source: "local_ai",
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
            promptTemplateVersion: "2026.07.v2",
            schemaVersion: "2026-07-24",
            skillPackVersion: "b".repeat(64),
            promptHash: "c".repeat(64),
          },
        }),
      },
    ));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_AI_RESULT");
  });

  it.each(["local_ai", "codex_batch"] as const)(
    "requires a current prompt receipt for %s output",
    async (source) => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      location: "Sydney",
      description: "Build product features",
      market: "AU",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });

    const res = await POST(
      new Request(
        "http://localhost/api/applications/manual-generate?finalize=false",
        {
          method: "POST",
          body: JSON.stringify({
            jobId: VALID_JOB_ID,
            target: "resume",
            modelOutput: JSON.stringify({
              cvSummary: "Strict",
              latestExperience: { addedBullets: [] },
            }),
            source,
          }),
        },
      ),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("PROMPT_META_REQUIRED");
    expect(applicationPrompt.buildApplicationPromptForUser).not.toHaveBeenCalled();
    },
  );

  it("rejects legacy Resume JSON from Codex Batch even with a complete receipt", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      location: "Sydney",
      description: "Build product features",
      market: "AU",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });

    const res = await POST(
      new Request(
        "http://localhost/api/applications/manual-generate?finalize=false",
        {
          method: "POST",
          body: JSON.stringify({
            jobId: VALID_JOB_ID,
            target: "resume",
            modelOutput: JSON.stringify({
              cvSummary: "Legacy",
              latestExperience: { bullets: ["Built APIs."] },
            }),
            source: "codex_batch",
            promptMeta: {
              ruleSetId: "rules-1",
              resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
              promptTemplateVersion: "2026.07.v2",
              schemaVersion: "2026-07-24",
              skillPackVersion: "b".repeat(64),
              promptHash: "c".repeat(64),
            },
          }),
        },
      ),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_AI_RESULT");
    expect(applicationPrompt.buildApplicationPromptForUser).toHaveBeenCalledWith(
      expect.objectContaining({ target: "resume", variant: "full" }),
    );
    expect(applicationStore.upsert).not.toHaveBeenCalled();
  });

  it("rejects a partial legacy receipt from Codex Batch", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      location: "Sydney",
      description: "Build product features",
      market: "AU",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });

    const res = await POST(
      new Request(
        "http://localhost/api/applications/manual-generate?finalize=false",
        {
          method: "POST",
          body: JSON.stringify({
            jobId: VALID_JOB_ID,
            target: "resume",
            modelOutput: JSON.stringify({
              cvSummary: "Strict",
              latestExperience: { addedBullets: [] },
            }),
            source: "codex_batch",
            promptMeta: {
              ruleSetId: "rules-1",
              resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
            },
          }),
        },
      ),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("PROMPT_META_REQUIRED");
    expect(applicationStore.upsert).not.toHaveBeenCalled();
  });

  it("rejects oversized local AI output with INVALID_AI_RESULT before persistence", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "user-1" } });
    const res = await POST(new Request("http://localhost/api/applications/manual-generate", {
      method: "POST",
      body: JSON.stringify({
        jobId: VALID_JOB_ID,
        target: "resume",
        modelOutput: "x".repeat(80_001),
        source: "local_ai",
      }),
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_AI_RESULT");
    expect(jobStore.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    {
      source: "manual_import" as const,
      variant: "full" as const,
      protocolSource: "MANUAL_IMPORT" as const,
    },
    {
      source: "local_ai" as const,
      variant: "lean" as const,
      protocolSource: "LOCAL_AI" as const,
    },
    {
      source: "codex_batch" as const,
      variant: "full" as const,
      protocolSource: "CODEX_BATCH" as const,
    },
  ])(
    "persists canonical $source provenance and authoritative DRAFT job metadata",
    async ({ source, variant, protocolSource }) => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "user-1" } });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Authoritative Role",
      company: "Authoritative Co",
      location: "Melbourne",
      description: "Build TypeScript APIs",
      market: "AU",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-local" });
    const modelOutput = JSON.stringify({
      cvSummary: "Strict local summary",
      latestExperience: {
        addedBullets: ["Automated TypeScript APIs delivery."],
      },
    });

    const res = await POST(new Request(
      "http://localhost/api/applications/manual-generate?finalize=false",
      {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput,
          source,
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
            promptTemplateVersion: "2026.07.v2",
            schemaVersion: "2026-07-24",
            skillPackVersion: "b".repeat(64),
            promptHash: "c".repeat(64),
          },
          tailoringRun: {
            id: TAILORING_RUN_ID,
            attemptId: TAILORING_ATTEMPT_ID,
          },
        }),
      },
    ));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.job).toEqual({
      id: VALID_JOB_ID,
      title: "Authoritative Role",
      company: "Authoritative Co",
      location: "Melbourne",
    });
    expect(json.aiContent.source).toBe(source);
    expect(json.aiContent.promptMetaHash).toMatch(/^[0-9a-f]{64}$/);
    expect(applicationPrompt.buildApplicationPromptForUser).toHaveBeenCalledWith(
      expect.objectContaining({ target: "resume", variant }),
    );
    expect(tailoringAcceptance.prepareTailoringRunAcceptance).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        jobId: VALID_JOB_ID,
        resumeProfileId: "rp-1",
        requests: [
          expect.objectContaining({
            handle: {
              id: TAILORING_RUN_ID,
              attemptId: TAILORING_ATTEMPT_ID,
            },
            source: protocolSource,
            delivery: "DRAFT",
            target: "RESUME",
            promptHash: "c".repeat(64),
          }),
        ],
      }),
    );
    expect(blobStore.put).not.toHaveBeenCalled();
    },
  );

  it("locks before re-reading and merging generated content", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      location: "Sydney",
      description: "Build product features",
      market: "AU",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });
    const order: string[] = [];
    transactionStore.executeRaw.mockImplementationOnce(async () => {
      order.push("lock");
      return 1;
    });
    applicationStore.findUnique.mockImplementationOnce(async () => {
      order.push("read");
      return {
        resumePdfUrl: null,
        coverPdfUrl: null,
        aiContent: makeExistingAiContent(),
      };
    });
    applicationStore.upsert.mockImplementationOnce(async () => {
      order.push("write");
      return { id: "app-locked" };
    });

    const response = await POST(
      new Request(
        "http://localhost/api/applications/manual-generate?finalize=false",
        {
          method: "POST",
          body: JSON.stringify({
            jobId: VALID_JOB_ID,
            target: "resume",
            modelOutput: VALID_OUTPUT,
            promptMeta: {
              ruleSetId: "rules-1",
              resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
            },
          }),
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(order).toEqual(["lock", "read", "write"]);
    expect(String(transactionStore.executeRaw.mock.calls[0]?.[0])).toContain(
      "pg_advisory_xact_lock",
    );
  });

  it("deletes an uploaded unique artifact when the DB commit fails", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      location: "Sydney",
      description: "Build product features",
      market: "AU",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });
    blobStore.put.mockResolvedValueOnce({
      url: "https://blob.vercel-storage.com/new-resume.pdf",
    });
    applicationStore.upsert.mockRejectedValueOnce(new Error("database down"));

    const response = await POST(
      new Request("http://localhost/api/applications/manual-generate", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput: VALID_OUTPUT,
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
          },
        }),
      }),
    );

    expect(response.status).toBe(500);
    expect(blobStore.del).toHaveBeenCalledWith(
      "https://blob.vercel-storage.com/new-resume.pdf",
      { token: "blob-token" },
    );
  });

  it("keeps the previous PDF when the Blob upload fails", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      location: "Sydney",
      description: "Build product features",
      market: "AU",
    });
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "rp-1",
      updatedAt: new Date("2026-02-06T00:00:00.000Z"),
    });
    applicationStore.findUnique.mockResolvedValueOnce({
      resumePdfUrl: "https://blob.vercel-storage.com/stale-resume.pdf",
      coverPdfUrl: null,
      aiContent: makeExistingAiContent(),
    });
    blobStore.put.mockRejectedValueOnce(new Error("blob unavailable"));
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    const response = await POST(
      new Request("http://localhost/api/applications/manual-generate", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput: VALID_OUTPUT,
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
          },
        }),
      }),
    );

    // This used to return 200 and commit a null URL, so a transient Blob
    // outage silently destroyed the user's existing PDF. A failed upload is
    // now a failed request, and the previous artifact is untouched.
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "APPLICATION_PERSIST_FAILED" },
    });
    expect(applicationStore.upsert).not.toHaveBeenCalled();
    expect(blobStore.del).not.toHaveBeenCalledWith(
      "https://blob.vercel-storage.com/stale-resume.pdf",
      expect.anything(),
    );
  });

  it("replays an exact DRAFT before changed prompt rules or render adapters run", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    rateLimitStore.enforce.mockImplementation(() => {
      throw new Error("rate limiter unavailable");
    });
    jobStore.findFirst.mockRejectedValue(new Error("current Job loader unavailable"));
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("current profile loader unavailable"),
    );
    applicationPrompt.buildApplicationPromptForUser.mockRejectedValue(
      new Error("the current rules are unavailable"),
    );
    (compileLatexToPdf as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("renderer unavailable"),
    );
    tailoringAcceptance.probeTailoringRunAcceptanceReplay.mockResolvedValueOnce({
      receipt: {
        runId: TAILORING_RUN_ID,
        target: "RESUME",
        executionAttemptId: TAILORING_ATTEMPT_ID,
        requestHash: "request-hash",
        applicationId: "app-replayed",
        aiContentHash: "receipt-content-hash",
        delivery: "DRAFT",
      },
      application: {
        id: "app-replayed",
        status: "DRAFT",
        aiContent: makeExistingAiContent(),
        aiContentHash: "current-content-hash",
        resumePdfName: "Jane Doe Software Engineer_CV.pdf",
        job: {
          id: VALID_JOB_ID,
          title: "Software Engineer",
          company: "Example Co",
          location: "Sydney",
        },
      },
    });

    const response = await POST(
      new Request(
        "http://localhost/api/applications/manual-generate?finalize=false",
        {
          method: "POST",
          body: JSON.stringify({
            jobId: VALID_JOB_ID,
            target: "resume",
            modelOutput: VALID_OUTPUT,
            source: "local_ai",
            promptMeta: {
              ruleSetId: "rules-1",
              resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
              promptTemplateVersion: "2026.07.v2",
              schemaVersion: "2026-07-24",
              skillPackVersion: "b".repeat(64),
              promptHash: "c".repeat(64),
            },
            tailoringRun: {
              id: TAILORING_RUN_ID,
              attemptId: TAILORING_ATTEMPT_ID,
            },
          }),
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-tailoring-replay")).toBe("exact");
    await expect(response.json()).resolves.toMatchObject({
      applicationId: "app-replayed",
      status: "DRAFT",
      aiContentHash: "current-content-hash",
      aiContent: makeExistingAiContent(),
      pdfName: "Jane Doe Software Engineer_CV.pdf",
      job: {
        id: VALID_JOB_ID,
        title: "Software Engineer",
        company: "Example Co",
        location: "Sydney",
      },
      replayed: true,
    });
    expect(rateLimitStore.enforce).not.toHaveBeenCalled();
    expect(jobStore.findFirst).not.toHaveBeenCalled();
    expect(getResumeProfile).not.toHaveBeenCalled();
    expect(applicationPrompt.buildApplicationPromptForUser).not.toHaveBeenCalled();
    expect(mapResumeProfile).not.toHaveBeenCalled();
    expect(renderResumeTex).not.toHaveBeenCalled();
    expect(compileLatexToPdf).not.toHaveBeenCalled();
    expect(blobStore.put).not.toHaveBeenCalled();
    expect(applicationStore.upsert).not.toHaveBeenCalled();
  });

  it("returns 409 when an accepted target is retried with different content", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    rateLimitStore.enforce.mockImplementation(() => {
      throw new Error("rate limiter unavailable");
    });
    jobStore.findFirst.mockRejectedValue(new Error("current Job loader unavailable"));
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("current profile loader unavailable"),
    );
    tailoringAcceptance.probeTailoringRunAcceptanceReplay.mockRejectedValueOnce(
      new TailoringRunError(
        "RECEIPT_CONFLICT",
        "The target was already accepted with different content",
      ),
    );

    const response = await POST(
      new Request(
        "http://localhost/api/applications/manual-generate?finalize=false",
        {
          method: "POST",
          body: JSON.stringify({
            jobId: VALID_JOB_ID,
            target: "resume",
            modelOutput: VALID_OUTPUT.replace(
              "Tailored summary",
              "Changed summary",
            ),
            source: "local_ai",
            promptMeta: {
              ruleSetId: "rules-1",
              resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
              promptTemplateVersion: "2026.07.v2",
              schemaVersion: "2026-07-24",
              skillPackVersion: "b".repeat(64),
              promptHash: "c".repeat(64),
            },
            tailoringRun: {
              id: TAILORING_RUN_ID,
              attemptId: TAILORING_ATTEMPT_ID,
            },
          }),
        },
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RECEIPT_CONFLICT" },
    });
    expect(rateLimitStore.enforce).not.toHaveBeenCalled();
    expect(jobStore.findFirst).not.toHaveBeenCalled();
    expect(getResumeProfile).not.toHaveBeenCalled();
    expect(applicationPrompt.buildApplicationPromptForUser).not.toHaveBeenCalled();
    expect(applicationStore.upsert).not.toHaveBeenCalled();
  });

  it("returns an exact FINAL acknowledgement without prompt, PDF, or Blob dependencies", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    rateLimitStore.enforce.mockImplementation(() => {
      throw new Error("rate limiter unavailable");
    });
    jobStore.findFirst.mockRejectedValue(new Error("current Job loader unavailable"));
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("current profile loader unavailable"),
    );
    applicationPrompt.buildApplicationPromptForUser.mockRejectedValue(
      new Error("the current rules are unavailable"),
    );
    (compileLatexToPdf as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("renderer unavailable"),
    );
    blobStore.put.mockRejectedValue(new Error("blob unavailable"));
    tailoringAcceptance.probeTailoringRunAcceptanceReplay.mockResolvedValueOnce({
      receipt: {
        runId: TAILORING_RUN_ID,
        target: "COVER",
        executionAttemptId: TAILORING_ATTEMPT_ID,
        requestHash: "request-hash",
        applicationId: "app-final-replayed",
        aiContentHash: "receipt-content-hash",
        delivery: "FINAL",
      },
      application: {
        id: "app-final-replayed",
        status: "FINAL",
        aiContent: makeExistingAiContent(),
        aiContentHash: "current-final-hash",
        resumePdfName: "Jane Doe Software Engineer_CV.pdf",
        job: {
          id: VALID_JOB_ID,
          title: "Software Engineer",
          company: "Example Co",
          location: "Sydney",
        },
      },
    });

    const response = await POST(
      new Request("http://localhost/api/applications/manual-generate", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "cover",
          modelOutput: VALID_OUTPUT,
          source: "codex_batch",
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
            promptTemplateVersion: "2026.07.v2",
            schemaVersion: "2026-07-24",
            skillPackVersion: "b".repeat(64),
            promptHash: "c".repeat(64),
          },
          tailoringRun: {
            id: TAILORING_RUN_ID,
            attemptId: TAILORING_ATTEMPT_ID,
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-tailoring-replay")).toBe("exact");
    expect(response.headers.get("x-tailoring-delivery")).toBe("FINAL");
    await expect(response.json()).resolves.toMatchObject({
      applicationId: "app-final-replayed",
      status: "FINAL",
      aiContentHash: "current-final-hash",
      acceptedDelivery: "FINAL",
      target: "cover",
      replayed: true,
    });
    expect(rateLimitStore.enforce).not.toHaveBeenCalled();
    expect(jobStore.findFirst).not.toHaveBeenCalled();
    expect(getResumeProfile).not.toHaveBeenCalled();
    expect(applicationPrompt.buildApplicationPromptForUser).not.toHaveBeenCalled();
    expect(mapResumeProfile).not.toHaveBeenCalled();
    expect(renderCoverLetterTex).not.toHaveBeenCalled();
    expect(compileLatexToPdf).not.toHaveBeenCalled();
    expect(blobStore.put).not.toHaveBeenCalled();
    expect(applicationStore.upsert).not.toHaveBeenCalled();
  });
});
