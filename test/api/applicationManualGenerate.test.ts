import { beforeEach, describe, expect, it, vi } from "vitest";

const jobStore = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

const applicationStore = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

const blobStore = vi.hoisted(() => ({
  put: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    job: jobStore,
    application: applicationStore,
  },
}));

vi.mock("@vercel/blob", () => ({
  put: blobStore.put,
}));

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/server/resumeProfile", () => ({
  getResumeProfile: vi.fn(),
}));

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
import { POST } from "@/app/api/applications/manual-generate/route";

const VALID_JOB_ID = "550e8400-e29b-41d4-a716-446655440000";
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

describe("applications manual generate api", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    (getResumeProfile as unknown as ReturnType<typeof vi.fn>).mockReset();
    (mapResumeProfile as unknown as ReturnType<typeof vi.fn>).mockReset();
    (renderResumeTex as unknown as ReturnType<typeof vi.fn>).mockReset();
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
    jobStore.findFirst.mockReset();
    applicationStore.findUnique.mockReset();
    applicationStore.upsert.mockReset();
    blobStore.put.mockReset();
    delete process.env.BLOB_READ_WRITE_TOKEN;
    applicationStore.findUnique.mockResolvedValue(null);
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
          },
        }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("PARSE_FAILED");
  });

  it("rejects imports that do not include promptMeta", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });

    const res = await POST(
      new Request("http://localhost/api/applications/manual-generate", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput: VALID_OUTPUT,
        }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("INVALID_BODY");
    expect(jobStore.findFirst).not.toHaveBeenCalled();
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

  it("applies latest experience bullets and full skillsFinal for resume target", async () => {
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
      "Maintained CI/CD pipelines on Linux.",
      "Built Java services for internal APIs.",
    ]);
    expect(renderCallArg.skills).toEqual([
      { label: "Backend", items: ["Java", "Spring Boot"] },
      { label: "Cloud", items: ["GCP"] },
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
    expect(res.headers.get("content-disposition")).toContain("Cover_Letter.pdf");
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
      `applications/user-1/${VALID_JOB_ID}/cover.latest.pdf`,
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
});
