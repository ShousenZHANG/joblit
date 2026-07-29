import {
  artifactLifecycle,
  batch,
  blob,
  combinedAiContent,
  dependencies,
  job,
  resumeAiContent,
  stores,
  tailoringAcceptance,
  tailoringHandle,
  tailoringRunId,
} from "./executeServerBatchTailoringTask.testHarness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { executeServerBatchTailoringTask } from "./executeServerBatchTailoringTask";

describe("executeServerBatchTailoringTask", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "blob-token");
    stores.operations.length = 0;
    stores.job.findFirst.mockResolvedValue(job);
    stores.application.findUnique.mockImplementation(async () => {
      stores.operations.push("application.findUnique");
      return {
        aiContentHash: "baseline-ai-content-hash",
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
    tailoringAcceptance.prepareTailoringRunAcceptance.mockImplementation(
      async (_tx, input) => ({
        userId: input.userId,
        pending: [...input.requests],
        replayed: [],
        runs: [],
      }),
    );
    tailoringAcceptance.completeTailoringRunAcceptance.mockResolvedValue({
      receipts: [],
      completedRunIds: [],
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
    const result = await executeServerBatchTailoringTask({
      userId: "user-1",
      jobId: job.id,
      ...batch,
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
      "application.findUnique",
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
      executeServerBatchTailoringTask({
        userId: "user-1",
        jobId: job.id,
        ...batch,
      }),
    ).rejects.toMatchObject({ code: "JOB_NOT_FOUND", status: 404 });

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
      executeServerBatchTailoringTask({
        userId: "user-1",
        jobId: job.id,
        ...batch,
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
      executeServerBatchTailoringTask({
        userId: "user-1",
        jobId: job.id,
        ...batch,
      }),
    ).rejects.toMatchObject({ code: "ATS_PDF_VALIDATION_FAILED", status: 422 });

    expect(blob.put).not.toHaveBeenCalled();
    expect(stores.application.upsert).not.toHaveBeenCalled();
  });

  it("maps unavailable artifact storage to a typed retryable service error", async () => {
    dependencies.commitApplicationArtifact.mockResolvedValueOnce({
      kind: "blob_not_configured",
    });

    await expect(
      executeServerBatchTailoringTask({
        userId: "user-1",
        jobId: job.id,
        ...batch,
      }),
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
      executeServerBatchTailoringTask({
        userId: "user-1",
        jobId: job.id,
        ...batch,
      }),
    ).rejects.toMatchObject({
      code: "STALE_RENDER_CONTEXT",
      status: 409,
    });
  });

  it("maps a concurrent Application edit to a stable CAS conflict", async () => {
    dependencies.commitApplicationArtifact.mockResolvedValueOnce({
      kind: "stale_write",
    });

    await expect(
      executeServerBatchTailoringTask({
        userId: "user-1",
        jobId: job.id,
        ...batch,
      }),
    ).rejects.toMatchObject({
      code: "APPLICATION_CONTENT_CHANGED",
      status: 409,
      publicMessage:
        "The application changed while the documents were generating. Generate them again.",
    });

    expect(dependencies.failTailoringRun).toHaveBeenCalledWith({
      userId: "user-1",
      handle: tailoringHandle,
      errorCode: "SERVER_BATCH_FAILED",
      errorMessage: "Server batch generation failed",
      batchExecutionAttemptId: batch.executionAttemptId,
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

    const result = await executeServerBatchTailoringTask({
      userId: "user-1",
      jobId: job.id,
      ...batch,
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
    expect(commit.expectedHash).toBe("baseline-ai-content-hash");
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

    const result = await executeServerBatchTailoringTask({
      userId: "user-1",
      jobId: job.id,
      ...batch,
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

    const result = await executeServerBatchTailoringTask({
      userId: "user-1",
      jobId: job.id,
      ...batch,
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
      executeServerBatchTailoringTask({
        userId: "user-1",
        jobId: job.id,
        ...batch,
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
      executeServerBatchTailoringTask({
        userId: "user-1",
        jobId: job.id,
        ...batch,
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
