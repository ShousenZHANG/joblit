import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const artifactLifecycle = vi.hoisted(() => ({
  stageApplicationArtifact: vi.fn(),
  recordUploadedArtifact: vi.fn(),
  markArtifactsReferencedAndRetireSuperseded: vi.fn(),
  retireStagedArtifacts: vi.fn(),
}));

const transactionStore = vi.hoisted(() => ({
  run: vi.fn(),
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
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

vi.mock(
  "@/lib/server/artifacts/applicationArtifactLifecycle",
  () => artifactLifecycle,
);

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
import { POST } from "@/app/api/applications/manual-generate/route";

const VALID_JOB_ID = "550e8400-e29b-41d4-a716-446655440000";
const TAILORING_RUN_ID = "770e8400-e29b-41d4-a716-446655440000";
const TAILORING_ATTEMPT_ID = "880e8400-e29b-41d4-a716-446655440000";

/**
 * The Master Resume Profile every import is judged against: the skill bank the
 * selection indexes address, and the only text the summary lint will accept a
 * number or a skill from.
 */
const PROFILE = {
  id: "rp-1",
  updatedAt: new Date("2026-02-06T00:00:00.000Z"),
  skills: [
    { label: "Backend", items: ["Java", "Spring Boot"] },
    { label: "Platform", items: ["Linux", "Docker"] },
  ],
};

/**
 * Names the target role, states no figure the profile cannot support, and
 * mentions no skill the candidate has not written. Anything else is a 422.
 */
const VALID_SUMMARY =
  "Software Engineer delivering Java and Spring Boot services on Linux, with " +
  "Docker-based delivery pipelines and a focus on dependable production " +
  "releases for platform teams.";

/** Platform first, then Backend: a real reorder, not the profile's own order. */
const VALID_SELECTION = [
  { group: 1, items: [1, 0] },
  { group: 0, items: [0] },
];

const VALID_OUTPUT = JSON.stringify({
  cvSummary: VALID_SUMMARY,
  skillsSelection: VALID_SELECTION,
  cover: {
    paragraphOne: "One",
    paragraphTwo: "Two",
    paragraphThree: "Three",
  },
});

function makeExistingAiContent() {
  return {
    schemaVersion: 2,
    generatedAt: "2026-07-19T00:00:00.000Z",
    promptMetaHash: "existing-prompt",
    source: "manual_import",
    cv: {
      summary: {
        aiText: "Existing CV summary",
        originalText: "Base summary",
        accepted: true,
      },
      skillsSelection: { aiSelection: [{ group: 0, items: [0] }] },
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
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "test");
    applicationPrompt.buildApplicationPromptForUser
      .mockReset()
      .mockResolvedValue({
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
    (renderResumeTex as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      "\\documentclass{article}",
    );
    (
      renderCoverLetterTex as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValue("\\documentclass{article}");
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
    artifactLifecycle.stageApplicationArtifact
      .mockReset()
      .mockImplementation(async (input) => {
        const stem = input.target === "RESUME_PDF" ? "resume" : "cover";
        const pathname =
          `applications/${input.userId}/${input.jobId}/` +
          `${stem}.${input.contentVersion}-1234abcd-${"0".repeat(64)}.pdf`;
        return {
          disposition: "STAGED",
          pathname,
          contentHash: "0".repeat(64),
          artifact: {
            id: `artifact-${artifactLifecycle.stageApplicationArtifact.mock.calls.length}`,
            userId: input.userId,
            jobId: input.jobId,
            applicationId: null,
            target: input.target,
            state: "STAGED",
            pathname,
            url: null,
            contentVersion: input.contentVersion,
            contentHash: "0".repeat(64),
          },
        };
      });
    artifactLifecycle.recordUploadedArtifact
      .mockReset()
      .mockImplementation(async (input) => ({
        disposition: "RECORDED",
        artifact: {
          id: input.artifactId,
          state: "STAGED",
          pathname: input.pathname,
          url: input.url,
        },
      }));
    artifactLifecycle.markArtifactsReferencedAndRetireSuperseded
      .mockReset()
      .mockResolvedValue({ referenced: 1, retired: 0 });
    artifactLifecycle.retireStagedArtifacts
      .mockReset()
      .mockResolvedValue({ queued: 1, awaitingUploadResolution: 0 });
    transactionStore.executeRaw.mockReset();
    transactionStore.executeRaw.mockResolvedValue(1);
    transactionStore.queryRaw.mockReset();
    transactionStore.queryRaw.mockImplementation(async () => {
      const routeJob = await jobStore.findFirst.mock.results[0]?.value;
      return [
        {
          profileSummary: null,
          profileBasics: null,
          profileLinks: null,
          profileSkills: null,
          profileExperiences: null,
          profileProjects: null,
          profileEducation: null,
          jobTitle: routeJob?.title ?? "Untitled",
          jobCompany: routeJob?.company ?? null,
          jobMarket: routeJob?.market ?? "AU",
        },
      ];
    });
    transactionStore.run.mockReset();
    transactionStore.run.mockImplementation(
      async (
        callback: (tx: {
          job: typeof jobStore;
          application: typeof applicationStore;
          evidenceSnapshot: {
            createMany: typeof evidenceStore.evidenceCreateMany;
          };
          claimEvidence: { createMany: typeof evidenceStore.claimCreateMany };
          $executeRaw: typeof transactionStore.executeRaw;
          $queryRaw: typeof transactionStore.queryRaw;
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
          $queryRaw: transactionStore.queryRaw,
        }),
    );
    delete process.env.BLOB_READ_WRITE_TOKEN;
    applicationStore.findUnique.mockResolvedValue(null);
    evidenceStore.evidenceCreateMany
      .mockReset()
      .mockResolvedValue({ count: 1 });
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

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns parse error for invalid model output", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(PROFILE);

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
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      location: "Sydney",
      description: "Build product features",
      market: "AU",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(PROFILE);
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    const res = await POST(
      new Request(
        "http://localhost/api/applications/manual-generate?finalize=false",
        {
          method: "POST",
          body: JSON.stringify({
            jobId: VALID_JOB_ID,
            target: "resume",
            modelOutput: VALID_OUTPUT,
          }),
        },
      ),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.aiContent.promptMetaHash).toBe("");
    expect(json.aiContent.source).toBe("manual_import");
    expect(json.aiContent.provenance).toBeUndefined();
  });

  it("does not attribute a partial legacy receipt to the current exact prompt", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      location: "Sydney",
      description: "Build product features",
      market: "AU",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(PROFILE);
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    const res = await POST(
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
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.aiContent.promptMetaHash).toBe("");
    expect(json.aiContent.provenance).toBeUndefined();
  });

  it("generates resume pdf from imported JSON", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(PROFILE);
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

  // The grounding gate used to fire at the commit boundary, after the PDF had
  // already been compiled and uploaded. The summary lint runs before any of
  // that, so an ungrounded claim costs no render.
  it("rejects an ungrounded finalize before compiling or uploading anything", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(PROFILE);
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    const res = await POST(
      new Request("http://localhost/api/applications/manual-generate", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "resume",
          modelOutput: JSON.stringify({
            // A figure the master profile never states.
            cvSummary:
              "Software Engineer delivering Java and Spring Boot services on " +
              "Linux, cutting infrastructure spend by 9400% with Docker " +
              "pipelines and dependable production releases for platform teams.",
            skillsSelection: VALID_SELECTION,
          }),
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

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("SUMMARY_UNGROUNDED_NUMBER");
    expect(compileLatexToPdf).not.toHaveBeenCalled();
    expect(artifactLifecycle.stageApplicationArtifact).not.toHaveBeenCalled();
    expect(applicationStore.upsert).not.toHaveBeenCalled();
  });

  it("accepts resume JSON when model output includes commentary and trailing brace text", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(PROFILE);
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    const noisyOutput = [
      "Sure - generated output below:",
      "```json",
      "{",
      `  "cvSummary": ${JSON.stringify(VALID_SUMMARY)},`,
      `  "skillsSelection": ${JSON.stringify(VALID_SELECTION)}`,
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

  it("preserves Master Profile bullets and renders only the profile's own skills", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(PROFILE);
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    (
      mapResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValueOnce({
      candidate: {
        name: "Jane Doe",
        title: "Software Engineer",
        email: "jane@example.com",
        phone: "+1 555 0100",
      },
      summary: "Base summary",
      skills: [
        { label: "Backend", items: ["Java", "Spring Boot"] },
        { label: "Platform", items: ["Linux", "Docker"] },
      ],
      experiences: [
        {
          location: "Sydney, AU",
          dates: "2022-2023",
          title: "Engineer",
          company: "Example",
          bullets: [
            "Built Java services for internal APIs.",
            "Maintained CI/CD pipelines on Linux.",
          ],
        },
      ],
      projects: [],
      education: [],
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

    expect(res.status).toBe(200);
    const renderCallArg = (
      renderResumeTex as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(renderCallArg.summary).toBe(VALID_SUMMARY);
    // Experience is no longer a tailoring surface: the profile's own bullets
    // reach the renderer in the profile's own order.
    expect(renderCallArg.experiences[0].bullets).toEqual([
      "Built Java services for internal APIs.",
      "Maintained CI/CD pipelines on Linux.",
    ]);
    // The selection reorders and narrows the candidate's own groups; every
    // string here came out of the profile, none out of the model.
    expect(renderCallArg.skills).toEqual([
      { label: "Platform", items: ["Docker", "Linux"] },
      { label: "Backend", items: ["Java"] },
    ]);
  });

  it("allows resume import even when top responsibilities are not fully covered", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description:
        "Design and build scalable backend services and CI/CD pipelines for cloud platform delivery.",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(PROFILE);
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    (
      mapResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValueOnce({
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
  });

  it("uses AI-provided markdown bold in the summary for latex rendering", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build Java services with CI/CD and Docker",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(PROFILE);
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    (
      mapResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValueOnce({
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
      cvSummary: VALID_SUMMARY.replace("Java", "**Java**"),
      skillsSelection: VALID_SELECTION,
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
    const renderCallArg = (
      renderResumeTex as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.at(-1)?.[0];
    expect(renderCallArg.summary).toContain("\\textbf{Java}");
  });

  /**
   * The gates that replaced the evidence ledger. Both run at the import
   * boundary — before anything is rendered, uploaded or persisted — and both
   * are deterministic string comparisons against the candidate's own profile,
   * so no model is asked to judge a model.
   */
  describe("the import boundary refuses content the profile cannot support", () => {
    function importResume(modelOutput: string) {
      (
        getServerSession as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ user: { id: "user-1" } });
      jobStore.findFirst.mockResolvedValueOnce({
        id: VALID_JOB_ID,
        title: "Software Engineer",
        company: "Example Co",
        description: "Build product features",
        market: "AU",
      });
      (
        getResumeProfile as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce(PROFILE);

      return POST(
        new Request(
          "http://localhost/api/applications/manual-generate?finalize=false",
          {
            method: "POST",
            body: JSON.stringify({
              jobId: VALID_JOB_ID,
              target: "resume",
              modelOutput,
              promptMeta: {
                ruleSetId: "rules-1",
                resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
              },
            }),
          },
        ),
      );
    }

    it("returns 422 SUMMARY_TITLE_MISSING when the summary omits the job title", async () => {
      const res = await importResume(
        JSON.stringify({
          cvSummary:
            "Backend specialist delivering Java and Spring Boot services on " +
            "Linux, with Docker-based delivery pipelines and a focus on " +
            "dependable production releases for platform teams.",
          skillsSelection: VALID_SELECTION,
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(422);
      expect(json.error.code).toBe("SUMMARY_TITLE_MISSING");
      expect(applicationStore.upsert).not.toHaveBeenCalled();
    });

    it("returns 422 SUMMARY_UNGROUNDED_NUMBER when the summary invents a figure", async () => {
      const res = await importResume(
        JSON.stringify({
          cvSummary:
            "Software Engineer delivering Java and Spring Boot services on " +
            "Linux, cutting release time by 63% with Docker pipelines and " +
            "dependable production releases for platform teams.",
          skillsSelection: VALID_SELECTION,
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(422);
      expect(json.error.code).toBe("SUMMARY_UNGROUNDED_NUMBER");
      expect(json.error.message).toContain("63%");
      expect(applicationStore.upsert).not.toHaveBeenCalled();
    });

    it("returns 422 SUMMARY_UNGROUNDED_SKILL when the summary claims a skill the profile lacks", async () => {
      const res = await importResume(
        JSON.stringify({
          cvSummary:
            "Software Engineer delivering Java and Kubernetes services on " +
            "Linux, with Docker-based delivery pipelines and a focus on " +
            "dependable production releases for platform teams.",
          skillsSelection: VALID_SELECTION,
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(422);
      expect(json.error.code).toBe("SUMMARY_UNGROUNDED_SKILL");
      expect(json.error.message).toContain("Kubernetes");
      expect(applicationStore.upsert).not.toHaveBeenCalled();
    });

    it("returns 400 SKILLS_SELECTION_INVALID for a group index outside the bank", async () => {
      const res = await importResume(
        JSON.stringify({
          cvSummary: VALID_SUMMARY,
          skillsSelection: [{ group: 5, items: [0] }],
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error.code).toBe("SKILLS_SELECTION_INVALID");
      expect(applicationStore.upsert).not.toHaveBeenCalled();
    });

    it("returns 400 SKILLS_SELECTION_INVALID for an item index outside its group", async () => {
      const res = await importResume(
        JSON.stringify({
          cvSummary: VALID_SUMMARY,
          skillsSelection: [{ group: 0, items: [0, 4] }],
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error.code).toBe("SKILLS_SELECTION_INVALID");
      expect(applicationStore.upsert).not.toHaveBeenCalled();
    });

    it("persists the selection the model returned when everything resolves", async () => {
      applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

      const res = await importResume(VALID_OUTPUT);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.aiContent.cv.summary.aiText).toBe(VALID_SUMMARY);
      expect(json.aiContent.cv.skillsSelection).toEqual({
        aiSelection: VALID_SELECTION,
      });
      expect(applicationStore.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            aiContent: expect.objectContaining({
              cv: expect.objectContaining({
                skillsSelection: { aiSelection: VALID_SELECTION },
              }),
            }),
          }),
        }),
      );
    });
  });

  it("returns 409 when prompt meta is stale", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
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
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(PROFILE);

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
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(PROFILE);

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
      expect.objectContaining({
        field: "skillPackVersion",
        received: "stale-pack",
      }),
    ]);
  });

  it("soft-fails quality gate but still generates manual cover pdf", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(PROFILE);
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
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
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

  it("returns 503 before staging a production FINAL when Blob is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(PROFILE);

    const response = await POST(
      new Request("http://localhost/api/applications/manual-generate", {
        method: "POST",
        body: JSON.stringify({
          jobId: VALID_JOB_ID,
          target: "cover",
          modelOutput: JSON.stringify({
            cover: {
              paragraphOne: "I am applying for this role.",
              paragraphTwo: "My experience aligns with your responsibilities.",
              paragraphThree: "I am motivated by your product impact.",
            },
          }),
          promptMeta: {
            ruleSetId: "rules-1",
            resumeSnapshotUpdatedAt: "2026-02-06T00:00:00.000Z",
          },
        }),
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ARTIFACT_STORAGE_UNAVAILABLE" },
    });
    expect(artifactLifecycle.stageApplicationArtifact).not.toHaveBeenCalled();
    expect(blobStore.put).not.toHaveBeenCalled();
    expect(applicationStore.upsert).not.toHaveBeenCalled();
  });

  it("persists cover pdf url when blob token is configured", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(PROFILE);
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
          `^applications/user-1/${VALID_JOB_ID}/cover\\.[0-9a-f]{64}-[0-9a-f]{8}-[0-9a-f]{64}\\.pdf$`,
        ),
      ),
      expect.anything(),
      expect.objectContaining({
        allowOverwrite: true,
        addRandomSuffix: false,
        token: "blob-token",
      }),
    );
    expect(artifactLifecycle.stageApplicationArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        jobId: VALID_JOB_ID,
        target: "COVER_PDF",
        contentVersion: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    expect(
      artifactLifecycle.markArtifactsReferencedAndRetireSuperseded,
    ).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        jobId: VALID_JOB_ID,
        applicationId: "app-1",
        referenced: [
          expect.objectContaining({
            target: "COVER_PDF",
            url: "https://blob.vercel-storage.com/cover.pdf",
          }),
        ],
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
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
      market: "AU",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(PROFILE);
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    const res = await POST(
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

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const json = await res.json();
    expect(json.applicationId).toBe("app-1");
    expect(json.status).toBe("DRAFT");
    expect(typeof json.aiContentHash).toBe("string");
    expect(json.aiContent.cv.summary.aiText).toBe(VALID_SUMMARY);
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
    expect(artifactLifecycle.stageApplicationArtifact).not.toHaveBeenCalled();
  });

  it("preserves an existing cover letter when importing a resume draft", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      location: "Sydney",
      description: "Build product features",
      market: "AU",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(PROFILE);
    const existing = makeExistingAiContent();
    applicationStore.findUnique.mockResolvedValueOnce({
      resumePdfUrl: null,
      coverPdfUrl: null,
      aiContent: existing,
    });
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    const res = await POST(
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
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.aiContent.cv.summary.aiText).toBe(VALID_SUMMARY);
    expect(json.aiContent.cover).toMatchObject(existing.cover);
    // The merge must not resurrect the retired ledger or bullet halves.
    expect(json.aiContent.schemaVersion).toBe(2);
    expect(json.aiContent.review).toBeUndefined();
    expect(json.aiContent.cv.latestExperience).toBeUndefined();
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
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      location: "Sydney",
      description: "Build product features",
      market: "AU",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(PROFILE);
    const existing = makeExistingAiContent();
    applicationStore.findUnique.mockResolvedValueOnce({
      resumePdfUrl: null,
      coverPdfUrl: null,
      aiContent: existing,
    });
    applicationStore.upsert.mockResolvedValueOnce({ id: "app-1" });

    const res = await POST(
      new Request(
        "http://localhost/api/applications/manual-generate?finalize=false",
        {
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
        },
      ),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.aiContent.cv).toMatchObject(existing.cv);
    expect(json.aiContent.cover.paragraphOne.aiText).toBe("New cover one");
    // The merge must not resurrect the retired ledger or bullet halves.
    expect(json.aiContent.schemaVersion).toBe(2);
    expect(json.aiContent.review).toBeUndefined();
    expect(json.aiContent.cv.latestExperience).toBeUndefined();
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
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      location: "Sydney",
      description: "Build product features",
      market: "AU",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(PROFILE);
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
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error.code).toBe("AI_CONTENT_INVALID");
    expect(applicationStore.upsert).not.toHaveBeenCalled();
  });

  it("locks before re-reading and merging generated content", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      location: "Sydney",
      description: "Build product features",
      market: "AU",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(PROFILE);
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

  it("durably retires an uploaded unique artifact when the DB commit fails", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      location: "Sydney",
      description: "Build product features",
      market: "AU",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(PROFILE);
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
    expect(artifactLifecycle.retireStagedArtifacts).toHaveBeenCalledWith({
      userId: "user-1",
      jobId: VALID_JOB_ID,
      artifactIds: ["artifact-1"],
    });
    expect(blobStore.del).not.toHaveBeenCalled();
  });

  it("keeps the previous PDF when the Blob upload fails", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      location: "Sydney",
      description: "Build product features",
      market: "AU",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(PROFILE);
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
    expect(artifactLifecycle.retireStagedArtifacts).toHaveBeenCalledWith({
      userId: "user-1",
      jobId: VALID_JOB_ID,
      artifactIds: ["artifact-1"],
    });
    expect(blobStore.del).not.toHaveBeenCalledWith(
      "https://blob.vercel-storage.com/stale-resume.pdf",
      expect.anything(),
    );
  });

  it("returns a retryable 409 and retires the upload when render inputs change before commit", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    jobStore.findFirst.mockResolvedValueOnce({
      id: VALID_JOB_ID,
      title: "Software Engineer",
      company: "Example Co",
      description: "Build product features",
      market: "AU",
    });
    (
      getResumeProfile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(PROFILE);
    blobStore.put.mockResolvedValueOnce({
      url: "https://blob.vercel-storage.com/stale-render.pdf",
    });
    transactionStore.queryRaw.mockResolvedValueOnce([
      {
        profileSummary: null,
        profileBasics: null,
        profileLinks: null,
        profileSkills: null,
        profileExperiences: null,
        profileProjects: null,
        profileEducation: null,
        jobTitle: "Software Engineer",
        jobCompany: "Example Co",
        jobMarket: "CN",
      },
    ]);

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

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "STALE_RENDER_CONTEXT" },
    });
    expect(applicationStore.upsert).not.toHaveBeenCalled();
    expect(artifactLifecycle.retireStagedArtifacts).toHaveBeenCalledWith({
      userId: "user-1",
      jobId: VALID_JOB_ID,
      artifactIds: ["artifact-1"],
    });
  });

});
