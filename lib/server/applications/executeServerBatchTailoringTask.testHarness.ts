import { vi } from "vitest";

const harness = vi.hoisted(() => ({
  stores: {
    job: { findFirst: vi.fn() },
    application: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    evidenceSnapshot: { createMany: vi.fn() },
    claimEvidence: { createMany: vi.fn() },
    executeRaw: vi.fn(),
    queryRaw: vi.fn(),
    transaction: vi.fn(),
    operations: [] as string[],
  },
  dependencies: {
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
  },
  blob: {
    del: vi.fn(),
    put: vi.fn(),
  },
  artifactLifecycle: {
    stageApplicationArtifact: vi.fn(),
    recordUploadedArtifact: vi.fn(),
    markArtifactsReferencedAndRetireSuperseded: vi.fn(),
    retireStagedArtifacts: vi.fn(),
  },
  tailoringAcceptance: {
    prepareTailoringRunAcceptance: vi.fn(),
    completeTailoringRunAcceptance: vi.fn(),
  },
}));

export const stores = harness.stores;
export const dependencies = harness.dependencies;
export const blob = harness.blob;
export const artifactLifecycle = harness.artifactLifecycle;
export const tailoringAcceptance = harness.tailoringAcceptance;

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
vi.mock("@/lib/server/applications/atsPdfValidator", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/server/applications/atsPdfValidator")
    >();
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
vi.mock(
  "@/lib/server/tailoringRuns/tailoringRunAcceptance",
  () => tailoringAcceptance,
);

export const job = {
  id: "job-1",
  title: "Engineer",
  company: "Joblit",
  description: "Build reliable systems",
  market: "AU",
};

export const batch = {
  batchId: "batch-1",
  taskId: "task-1",
  executionAttemptId: "00000000-0000-4000-8000-000000000001",
  issueKey: "00000000-0000-5000-8000-000000000003",
} as const;

export const tailoringRunId = "00000000-0000-4000-8000-000000000002";
export const tailoringHandle = {
  id: tailoringRunId,
  attemptId: batch.executionAttemptId,
} as const;
const generatedAt = "2026-07-24T00:00:00.000Z";

export const resumeAiContent = {
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

export const combinedAiContent = {
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
