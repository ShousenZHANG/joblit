import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => ({
  job: {
    findFirst: vi.fn(),
  },
  application: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  evidenceSnapshot: {
    createMany: vi.fn(),
  },
  claimEvidence: {
    createMany: vi.fn(),
  },
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  operations: [] as string[],
}));
const dependencies = vi.hoisted(() => ({
  buildResumePdfForJob: vi.fn(),
  compileLatexToPdf: vi.fn(),
  getResumeProfile: vi.fn(),
  renderCoverLetterTex: vi.fn(),
  tailorApplicationContent: vi.fn(),
  assertAtsPdf: vi.fn(),
  acceptApplicationGeneration: vi.fn(),
  evolveApplicationAiContent: vi.fn(),
  commitApplicationArtifact: vi.fn(),
  issueTailoringRun: vi.fn(),
  startTailoringRun: vi.fn(),
  bindTailoringRunPrompt: vi.fn(),
  failTailoringRun: vi.fn(),
  completeBatchTask: vi.fn(),
}));
const blob = vi.hoisted(() => ({
  del: vi.fn(),
  put: vi.fn(),
}));
const artifactLifecycle = vi.hoisted(() => ({
  stageApplicationArtifact: vi.fn(),
  recordUploadedArtifact: vi.fn(),
  markArtifactsReferencedAndRetireSuperseded: vi.fn(),
  retireStagedArtifacts: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    job: stores.job,
    application: stores.application,
    $transaction: stores.transaction,
  },
}));
vi.mock("@/lib/server/applications/buildResumePdf", () => ({
  buildResumePdfForJob: dependencies.buildResumePdfForJob,
}));
vi.mock("@/lib/server/latex/compilePdf", () => ({
  compileLatexToPdf: dependencies.compileLatexToPdf,
}));
vi.mock("@/lib/server/resumeProfile", () => ({
  getResumeProfile: dependencies.getResumeProfile,
}));
vi.mock("@/lib/server/latex/renderCoverLetter", () => ({
  renderCoverLetterTex: dependencies.renderCoverLetterTex,
}));
vi.mock("@/lib/server/ai/tailorApplication", () => ({
  tailorApplicationContent: dependencies.tailorApplicationContent,
}));
vi.mock("@/lib/server/applications/applicationGeneration", () => ({
  acceptApplicationGeneration: dependencies.acceptApplicationGeneration,
}));
vi.mock("@/lib/server/applications/applicationAiContentAggregate", () => ({
  evolveApplicationAiContent: dependencies.evolveApplicationAiContent,
}));
vi.mock(
  "@/lib/server/applications/commitApplicationArtifact",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/server/applications/commitApplicationArtifact")
      >();
    dependencies.commitApplicationArtifact.mockImplementation(
      actual.commitApplicationArtifact,
    );
    return {
      ...actual,
      commitApplicationArtifact: dependencies.commitApplicationArtifact,
    };
  },
);
vi.mock("@/lib/server/tailoringRuns/tailoringRunService", () => ({
  issueTailoringRun: dependencies.issueTailoringRun,
  startTailoringRun: dependencies.startTailoringRun,
  bindTailoringRunPrompt: dependencies.bindTailoringRunPrompt,
  failTailoringRun: dependencies.failTailoringRun,
}));
vi.mock("@/lib/server/applicationBatches/runner", () => ({
  completeBatchTask: dependencies.completeBatchTask,
}));
/**
 * `assertAtsPdf` *throws* on failure — it does not resolve a report with
 * `passed: false`. A stub that only ever resolved could not tell a working gate
 * from one whose `if (!report.passed) throw` had been deleted, so the double
 * keeps the real contract: hand it a report and it throws when the report
 * fails, exactly as the module does.
 */
vi.mock("@/lib/server/applications/atsPdfValidator", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/server/applications/atsPdfValidator")>();
  return {
    ...actual,
    assertAtsPdf: async (...args: unknown[]) => {
      const report = await dependencies.assertAtsPdf(...args);
      if (report && report.passed === false) {
        throw new actual.AtsPdfValidationError(report);
      }
      return report;
    },
  };
});
vi.mock("@vercel/blob", () => blob);
vi.mock(
  "@/lib/server/artifacts/applicationArtifactLifecycle",
  () => artifactLifecycle,
);

import { generateApplicationArtifactsForJob } from "./generateApplicationArtifacts";

const job = {
  id: "job-1",
  title: "Engineer",
  company: "Joblit",
  description: "Build reliable systems",
  market: "AU",
};
const batch = {
  batchId: "batch-1",
  taskId: "task-1",
  executionAttemptId: "00000000-0000-4000-8000-000000000001",
  issueKey: "00000000-0000-5000-8000-000000000003",
  acceptedTargets: [],
  remainingTargets: ["RESUME", "COVER"],
} as const;
const tailoringRunId = "00000000-0000-4000-8000-000000000002";
const tailoringHandle = {
  id: tailoringRunId,
  attemptId: batch.executionAttemptId,
} as const;

const generatedAt = "2026-07-24T00:00:00.000Z";
const resumeAiContent = {
  schemaVersion: 1,
  generatedAt,
  promptMetaHash: "resume-hash",
  provenance: {
    resume: {
      generatedAt,
      promptMetaHash: "resume-hash",
      source: "server_batch",
    },
  },
  cv: {
    summary: {
      aiText: "Engineer",
      originalText: "Engineer",
      accepted: true,
    },
    latestExperience: {
      experienceIndex: 0,
      addedBullets: [],
    },
  },
  cover: {
    paragraphOne: { aiText: "", accepted: false },
    paragraphTwo: { aiText: "", accepted: false },
    paragraphThree: { aiText: "", accepted: false },
  },
} as const;
const combinedAiContent = {
  ...resumeAiContent,
  promptMetaHash: "cover-hash",
  provenance: {
    ...resumeAiContent.provenance,
    cover: {
      generatedAt,
      promptMetaHash: "cover-hash",
      source: "server_batch",
    },
  },
  cover: {
    paragraphOne: { aiText: "Canonical one", accepted: true },
    paragraphTwo: {
      aiText: "Canonical two",
      userEdit: "Canonical edited two",
      accepted: true,
    },
    paragraphThree: { aiText: "Canonical three", accepted: true },
  },
} as const;

describe("generateApplicationArtifactsForJob", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "blob-token");
    stores.operations.length = 0;
    stores.job.findFirst.mockResolvedValue(job);
    stores.application.findUnique.mockImplementation(async () => {
      stores.operations.push("application.findUnique");
      return {
        resumePdfUrl: "https://blob/old-resume.pdf",
        coverPdfUrl: "https://blob/old-cover.pdf",
      };
    });
    stores.application.upsert.mockImplementation(async () => {
      stores.operations.push("application.upsert");
      return { id: "application-1" };
    });
    stores.executeRaw.mockImplementation(async () => {
      stores.operations.push("application.lock");
      return 0;
    });
    stores.queryRaw.mockImplementation(async () => {
      stores.operations.push("render-context.lock");
      return [
        {
          profileSummary: null,
          profileBasics: null,
          profileLinks: null,
          profileSkills: null,
          profileExperiences: null,
          profileProjects: null,
          profileEducation: null,
          jobTitle: job.title,
          jobCompany: job.company,
          jobMarket: job.market,
        },
      ];
    });
    stores.transaction.mockImplementation(async (callback) =>
      callback({
        $executeRaw: stores.executeRaw,
        $queryRaw: stores.queryRaw,
        job: {
          findFirst: vi.fn(async () => {
            stores.operations.push("job.findFirst");
            return { id: job.id };
          }),
        },
        application: stores.application,
        evidenceSnapshot: stores.evidenceSnapshot,
        claimEvidence: stores.claimEvidence,
      }),
    );
    dependencies.getResumeProfile.mockResolvedValue({
      id: "profile-1",
    });
    dependencies.buildResumePdfForJob.mockResolvedValue({
      pdf: Buffer.from("resume"),
      renderInput: {
        candidate: {
          name: "Jane Doe",
          title: "Engineer",
          phone: "0400",
          email: "jane@example.com",
        },
        summary: "Engineer",
      },
      cv: {
        summary: {
          aiText: "Engineer",
          originalText: "Engineer",
          accepted: true,
        },
        latestExperience: {
          experienceIndex: 0,
          addedBullets: [],
        },
      },
      aiContent: resumeAiContent,
      tailored: {
        cvSummary: "Engineer",
        addedBullets: [],
        promptMetaHash: {
          resume: "resume-hash",
          cover: "cover-hash",
        },
        cover: {
          paragraphOne: "One",
          paragraphTwo: "Two",
          paragraphThree: "Three",
        },
        source: { cv: "ai", cover: "ai" },
        reason: "ai_ok",
        reviewer: {
          ran: true,
          revised: false,
          requirementCoverage: [],
        },
      },
    });
    stores.evidenceSnapshot.createMany.mockResolvedValue({ count: 1 });
    stores.claimEvidence.createMany.mockResolvedValue({ count: 1 });
    dependencies.assertAtsPdf.mockResolvedValue({
      passed: true,
      pageCount: 1,
      textLength: 400,
      keywordCoverage: 100,
      matchedKeywords: [],
      missingKeywords: [],
      errors: [],
      warnings: [],
    });
    dependencies.renderCoverLetterTex.mockReturnValue("cover tex");
    dependencies.acceptApplicationGeneration.mockReturnValue({
      ok: true,
      target: "cover",
      inputFormat: "current",
      aiContent: combinedAiContent,
      coverQualityGate: "pass",
      coverQualityIssueCount: 0,
    });
    dependencies.evolveApplicationAiContent.mockReturnValue({
      kind: "evolved",
      aiContent: combinedAiContent,
    });
    dependencies.issueTailoringRun.mockResolvedValue({
      disposition: "APPLIED",
      run: {
        id: tailoringRunId,
        requiredTargetMask: 3,
        acceptedTargetMask: 0,
      },
    });
    dependencies.startTailoringRun.mockResolvedValue({
      disposition: "APPLIED",
      run: { id: tailoringRunId },
      handle: tailoringHandle,
    });
    dependencies.bindTailoringRunPrompt.mockResolvedValue({
      disposition: "APPLIED",
      run: { id: tailoringRunId },
    });
    dependencies.failTailoringRun.mockResolvedValue({
      disposition: "APPLIED",
      run: { id: tailoringRunId },
    });
    dependencies.compileLatexToPdf.mockResolvedValue(Buffer.from("cover"));
    blob.put
      .mockResolvedValueOnce({ url: "https://blob/new-resume.pdf" })
      .mockResolvedValueOnce({ url: "https://blob/new-cover.pdf" });
    blob.del.mockResolvedValue(undefined);
    artifactLifecycle.stageApplicationArtifact.mockImplementation(
      async (input) => {
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
      },
    );
    artifactLifecycle.recordUploadedArtifact.mockImplementation(
      async (input) => ({
        disposition: "RECORDED",
        artifact: {
          id: input.artifactId,
          state: "STAGED",
          pathname: input.pathname,
          url: input.url,
        },
      }),
    );
    artifactLifecycle.markArtifactsReferencedAndRetireSuperseded.mockImplementation(
      async () => {
        stores.operations.push("artifact.mark");
        return { referenced: 2, retired: 2 };
      },
    );
    artifactLifecycle.retireStagedArtifacts.mockResolvedValue({
      queued: 2,
      awaitingUploadResolution: 0,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("locks, rechecks ownership, and commits reference plus retirements atomically", async () => {
    const result = await generateApplicationArtifactsForJob({
      userId: "user-1",
      jobId: job.id,
    });

    expect(result.applicationId).toBe("application-1");
    expect(dependencies.acceptApplicationGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "cover",
        source: "server_batch",
        promptMetaHash: "cover-hash",
        rawOutput: JSON.stringify({
          cover: {
            paragraphOne: "One",
            paragraphTwo: "Two",
            paragraphThree: "Three",
          },
        }),
      }),
    );
    expect(dependencies.evolveApplicationAiContent).toHaveBeenCalledWith(
      expect.objectContaining({
        current: resumeAiContent,
        command: expect.objectContaining({
          kind: "replace_target_proposal",
          target: "cover",
        }),
      }),
    );
    expect(dependencies.renderCoverLetterTex).toHaveBeenCalledWith(
      expect.objectContaining({
        paragraphOne: "Canonical one",
        paragraphTwo: "Canonical edited two",
        paragraphThree: "Canonical three",
      }),
    );
    expect(stores.operations).toEqual([
      "application.lock",
      "job.findFirst",
      "application.findUnique",
      "render-context.lock",
      "application.upsert",
      "artifact.mark",
    ]);
    expect(blob.put).toHaveBeenCalledTimes(2);
    expect(blob.put).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(
        /^applications\/user-1\/job-1\/resume\.[0-9a-f]{64}-[0-9a-f]{8}-[0-9a-f]{64}\.pdf$/,
      ),
      Buffer.from("resume"),
      expect.objectContaining({
        allowOverwrite: true,
        addRandomSuffix: false,
        token: "blob-token",
      }),
    );
    expect(
      artifactLifecycle.markArtifactsReferencedAndRetireSuperseded,
    ).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        jobId: "job-1",
        applicationId: "application-1",
        referenced: [
          expect.objectContaining({
            target: "RESUME_PDF",
            url: "https://blob/new-resume.pdf",
          }),
          expect.objectContaining({
            target: "COVER_PDF",
            url: "https://blob/new-cover.pdf",
          }),
        ],
        superseded: [
          { target: "RESUME_PDF", url: "https://blob/old-resume.pdf" },
          { target: "COVER_PDF", url: "https://blob/old-cover.pdf" },
        ],
      }),
    );
    expect(stores.application.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      artifactLifecycle.markArtifactsReferencedAndRetireSuperseded.mock
        .invocationCallOrder[0],
    );
    expect(blob.del).not.toHaveBeenCalled();
  });

  it("does not recreate an application when the job was deleted during generation", async () => {
    stores.transaction.mockImplementationOnce(async (callback) =>
      callback({
        $executeRaw: stores.executeRaw,
        job: {
          findFirst: vi.fn(async () => {
            stores.operations.push("job.findFirst");
            return null;
          }),
        },
        application: stores.application,
        evidenceSnapshot: stores.evidenceSnapshot,
        claimEvidence: stores.claimEvidence,
      }),
    );

    await expect(
      generateApplicationArtifactsForJob({
        userId: "user-1",
        jobId: job.id,
      }),
    ).rejects.toThrow("JOB_NOT_FOUND");

    expect(stores.application.upsert).not.toHaveBeenCalled();
    expect(artifactLifecycle.retireStagedArtifacts).toHaveBeenCalledWith({
      userId: "user-1",
      jobId: "job-1",
      artifactIds: ["artifact-1", "artifact-2"],
    });
    expect(blob.del).not.toHaveBeenCalled();
  });

  it("durably retires newly uploaded artifacts when the commit fails", async () => {
    stores.application.upsert.mockRejectedValueOnce(new Error("DB_DOWN"));

    await expect(
      generateApplicationArtifactsForJob({
        userId: "user-1",
        jobId: job.id,
      }),
    ).rejects.toThrow("DB_DOWN");

    expect(artifactLifecycle.retireStagedArtifacts).toHaveBeenCalledWith({
      userId: "user-1",
      jobId: "job-1",
      artifactIds: ["artifact-1", "artifact-2"],
    });
    expect(blob.del).not.toHaveBeenCalled();
  });

  it("aborts before uploading anything when the ATS gate rejects the PDF", async () => {
    // Previously unreachable: the stub only ever resolved, so a deleted gate
    // was indistinguishable from a working one.
    dependencies.assertAtsPdf.mockResolvedValueOnce({
      passed: false,
      pageCount: 4,
      textLength: 12,
      keywordCoverage: 0,
      matchedKeywords: [],
      missingKeywords: ["typescript"],
      errors: ["PDF has too little extractable text"],
      warnings: [],
    });

    await expect(
      generateApplicationArtifactsForJob({ userId: "user-1", jobId: job.id }),
    ).rejects.toMatchObject({ code: "ATS_PDF_VALIDATION_FAILED", status: 422 });

    expect(blob.put).not.toHaveBeenCalled();
    expect(stores.application.upsert).not.toHaveBeenCalled();
  });

  it("maps unavailable artifact storage to a typed retryable service error", async () => {
    dependencies.commitApplicationArtifact.mockResolvedValueOnce({
      kind: "blob_not_configured",
    });

    await expect(
      generateApplicationArtifactsForJob({ userId: "user-1", jobId: job.id }),
    ).rejects.toMatchObject({
      code: "ARTIFACT_STORAGE_UNAVAILABLE",
      status: 503,
      publicMessage:
        "PDF storage is not configured. Please try again after deployment configuration is restored.",
    });
  });

  it("maps a changed render context to a typed retryable conflict", async () => {
    dependencies.commitApplicationArtifact.mockResolvedValueOnce({
      kind: "stale_render_context",
    });

    await expect(
      generateApplicationArtifactsForJob({ userId: "user-1", jobId: job.id }),
    ).rejects.toMatchObject({
      code: "STALE_RENDER_CONTEXT",
      status: 409,
    });
  });

  it("binds a server batch run and commits both target receipts atomically", async () => {
    dependencies.commitApplicationArtifact.mockResolvedValueOnce({
      kind: "committed",
      applicationId: "application-1",
      aiContent: combinedAiContent,
      aiContentHash: "ai-content-hash",
      urls: {
        resume: "https://blob/batch-resume.pdf",
        cover: "https://blob/batch-cover.pdf",
      },
    });

    const result = await generateApplicationArtifactsForJob({
      userId: "user-1",
      jobId: job.id,
      batch,
    });

    expect(result).toMatchObject({
      applicationId: "application-1",
      jobId: job.id,
      resumePdfUrl: "https://blob/batch-resume.pdf",
      coverPdfUrl: "https://blob/batch-cover.pdf",
    });
    expect(dependencies.issueTailoringRun).toHaveBeenCalledTimes(1);
    const issue = dependencies.issueTailoringRun.mock.calls[0]?.[0];
    expect(issue).toEqual(
      expect.objectContaining({
        userId: "user-1",
        issueKey: batch.issueKey,
        jobId: job.id,
        resumeProfileId: "profile-1",
        source: "SERVER_BATCH",
        delivery: "FINAL",
        requiredTargets: ["RESUME", "COVER"],
        batch: {
          batchId: batch.batchId,
          taskId: batch.taskId,
          executionAttemptId: batch.executionAttemptId,
        },
        promptReceipts: {},
        resumeSnapshotHash: expect.any(String),
        jobSnapshotHash: expect.any(String),
      }),
    );
    expect(issue.resumeSnapshotHash).toHaveLength(64);
    expect(issue.jobSnapshotHash).toHaveLength(64);
    expect(dependencies.startTailoringRun).toHaveBeenCalledWith({
      userId: "user-1",
      runId: tailoringRunId,
      attemptId: batch.executionAttemptId,
      batchExecutionAttemptId: batch.executionAttemptId,
    });
    expect(dependencies.bindTailoringRunPrompt).toHaveBeenCalledTimes(2);
    expect(dependencies.bindTailoringRunPrompt).toHaveBeenNthCalledWith(1, {
      userId: "user-1",
      runId: tailoringRunId,
      target: "RESUME",
      receipt: {
        promptHash: "resume-hash",
        promptMetaHash: "resume-hash",
      },
      batchExecutionAttemptId: batch.executionAttemptId,
    });
    expect(dependencies.bindTailoringRunPrompt).toHaveBeenNthCalledWith(2, {
      userId: "user-1",
      runId: tailoringRunId,
      target: "COVER",
      receipt: {
        promptHash: "cover-hash",
        promptMetaHash: "cover-hash",
      },
      batchExecutionAttemptId: batch.executionAttemptId,
    });

    const commit = dependencies.commitApplicationArtifact.mock.calls.at(-1)?.[0];
    expect(commit.tailoring).toHaveLength(2);
    expect(commit.tailoring).toEqual([
      expect.objectContaining({
        handle: tailoringHandle,
        source: "SERVER_BATCH",
        delivery: "FINAL",
        target: "RESUME",
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        promptHash: "resume-hash",
        resumeSnapshotHash: issue.resumeSnapshotHash,
        jobSnapshotHash: issue.jobSnapshotHash,
        batchExecutionAttemptId: batch.executionAttemptId,
      }),
      expect.objectContaining({
        handle: tailoringHandle,
        source: "SERVER_BATCH",
        delivery: "FINAL",
        target: "COVER",
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        promptHash: "cover-hash",
        resumeSnapshotHash: issue.resumeSnapshotHash,
        jobSnapshotHash: issue.jobSnapshotHash,
        batchExecutionAttemptId: batch.executionAttemptId,
      }),
    ]);
    expect(commit.tailoring[0].requestHash).not.toBe(
      commit.tailoring[1].requestHash,
    );
    expect(
      dependencies.issueTailoringRun.mock.invocationCallOrder[0],
    ).toBeLessThan(dependencies.startTailoringRun.mock.invocationCallOrder[0]);
    expect(
      dependencies.bindTailoringRunPrompt.mock.invocationCallOrder[1],
    ).toBeLessThan(
      dependencies.commitApplicationArtifact.mock.invocationCallOrder[0],
    );
    expect(dependencies.completeBatchTask).not.toHaveBeenCalled();
    expect(dependencies.failTailoringRun).not.toHaveBeenCalled();
  });

  it("reclaims a partial run by accepting and merging only the missing target", async () => {
    const partialBatch = {
      ...batch,
      acceptedTargets: ["RESUME"],
      remainingTargets: ["COVER"],
    } as const;
    dependencies.issueTailoringRun.mockResolvedValueOnce({
      disposition: "REPLAYED",
      run: {
        id: tailoringRunId,
        requiredTargetMask: 3,
        acceptedTargetMask: 1,
      },
    });
    dependencies.commitApplicationArtifact.mockResolvedValueOnce({
      kind: "committed",
      applicationId: "application-1",
      aiContent: combinedAiContent,
      aiContentHash: "ai-content-hash",
      urls: {
        resume: "https://blob/preserved-resume.pdf",
        cover: "https://blob/recovered-cover.pdf",
      },
    });

    const result = await generateApplicationArtifactsForJob({
      userId: "user-1",
      jobId: job.id,
      batch: partialBatch,
    });

    expect(result).toMatchObject({
      resumePdfUrl: "https://blob/preserved-resume.pdf",
      coverPdfUrl: "https://blob/recovered-cover.pdf",
    });
    expect(dependencies.bindTailoringRunPrompt).toHaveBeenCalledOnce();
    expect(dependencies.bindTailoringRunPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ target: "COVER" }),
    );
    expect(dependencies.assertAtsPdf).toHaveBeenCalledOnce();
    expect(dependencies.buildResumePdfForJob).toHaveBeenCalledWith(
      expect.objectContaining({
        tailorOptions: expect.objectContaining({ targets: ["cover"] }),
      }),
    );
    const commit =
      dependencies.commitApplicationArtifact.mock.calls.at(-1)?.[0];
    expect(commit).toMatchObject({
      mergeTarget: "cover",
      artifacts: [expect.objectContaining({ target: "cover" })],
      tailoring: [expect.objectContaining({ target: "COVER" })],
    });
    expect(commit.artifacts).toHaveLength(1);
    expect(commit.tailoring).toHaveLength(1);
  });

  it("recovers resume-only without evaluating or replacing the accepted cover", async () => {
    const partialBatch = {
      ...batch,
      acceptedTargets: ["COVER"],
      remainingTargets: ["RESUME"],
    } as const;
    dependencies.issueTailoringRun.mockResolvedValueOnce({
      disposition: "REPLAYED",
      run: {
        id: tailoringRunId,
        requiredTargetMask: 3,
        acceptedTargetMask: 2,
      },
    });
    dependencies.acceptApplicationGeneration.mockImplementation(() => {
      throw new Error("cover acceptance must not run");
    });
    dependencies.commitApplicationArtifact.mockResolvedValueOnce({
      kind: "committed",
      applicationId: "application-1",
      aiContent: combinedAiContent,
      aiContentHash: "ai-content-hash",
      urls: {
        resume: "https://blob/recovered-resume.pdf",
        cover: "https://blob/preserved-cover.pdf",
      },
    });

    const result = await generateApplicationArtifactsForJob({
      userId: "user-1",
      jobId: job.id,
      batch: partialBatch,
    });

    expect(result).toMatchObject({
      resumePdfUrl: "https://blob/recovered-resume.pdf",
      coverPdfUrl: "https://blob/preserved-cover.pdf",
    });
    expect(dependencies.acceptApplicationGeneration).not.toHaveBeenCalled();
    expect(dependencies.evolveApplicationAiContent).not.toHaveBeenCalled();
    expect(dependencies.compileLatexToPdf).not.toHaveBeenCalled();
    expect(dependencies.buildResumePdfForJob).toHaveBeenCalledWith(
      expect.objectContaining({
        tailorOptions: expect.objectContaining({ targets: ["resume"] }),
      }),
    );
    const commit =
      dependencies.commitApplicationArtifact.mock.calls.at(-1)?.[0];
    expect(commit).toMatchObject({
      mergeTarget: "resume",
      artifacts: [expect.objectContaining({ target: "resume" })],
      tailoring: [expect.objectContaining({ target: "RESUME" })],
    });
    expect(commit.artifacts).toHaveLength(1);
    expect(commit.tailoring).toHaveLength(1);
  });

  it("best-effort fails the current run when server batch generation throws", async () => {
    const generationError = new Error(
      "provider rejected secret-token-and-private-output",
    );
    dependencies.buildResumePdfForJob.mockRejectedValueOnce(generationError);

    await expect(
      generateApplicationArtifactsForJob({
        userId: "user-1",
        jobId: job.id,
        batch,
      }),
    ).rejects.toBe(generationError);

    expect(dependencies.commitApplicationArtifact).not.toHaveBeenCalled();
    expect(dependencies.failTailoringRun).toHaveBeenCalledWith({
      userId: "user-1",
      handle: tailoringHandle,
      errorCode: "SERVER_BATCH_FAILED",
      errorMessage: "Server batch generation failed",
      batchExecutionAttemptId: batch.executionAttemptId,
    });
  });

  it("preserves a commit exception when recording the batch failure also fails", async () => {
    const commitError = new Error("database credentials leaked internally");
    dependencies.commitApplicationArtifact.mockRejectedValueOnce(commitError);
    dependencies.failTailoringRun.mockRejectedValueOnce(
      new Error("failure recorder unavailable"),
    );

    await expect(
      generateApplicationArtifactsForJob({
        userId: "user-1",
        jobId: job.id,
        batch,
      }),
    ).rejects.toBe(commitError);

    expect(dependencies.failTailoringRun).toHaveBeenCalledWith({
      userId: "user-1",
      handle: tailoringHandle,
      errorCode: "SERVER_BATCH_FAILED",
      errorMessage: "Server batch generation failed",
      batchExecutionAttemptId: batch.executionAttemptId,
    });
    expect(dependencies.completeBatchTask).not.toHaveBeenCalled();
  });
});
