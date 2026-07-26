import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiContent } from "@/lib/shared/schemas/aiContent";

const blob = vi.hoisted(() => ({ put: vi.fn(), del: vi.fn() }));
const store = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn() }));
const jobStore = vi.hoisted(() => ({ findFirst: vi.fn() }));
const ledger = vi.hoisted(() => ({ persistReviewLedger: vi.fn() }));
const lock = vi.hoisted(() => ({ acquireApplicationMutationLock: vi.fn() }));
const tailoringAcceptance = vi.hoisted(() => ({
  prepareTailoringRunAcceptance: vi.fn(),
  completeTailoringRunAcceptance: vi.fn(),
}));

vi.mock("@vercel/blob", () => blob);
vi.mock("@/lib/server/applications/persistReviewLedger", () => ledger);
vi.mock("@/lib/server/applications/applicationMutationLock", () => lock);
vi.mock(
  "@/lib/server/tailoringRuns/tailoringRunAcceptance",
  () => tailoringAcceptance,
);
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    application: store,
    // The fake `tx` exposes only what the module is allowed to touch, so a new
    // dependency shows up as a failure rather than passing silently.
    $transaction: (fn: (tx: unknown) => unknown) => fn({ application: store, job: jobStore }),
  },
}));

const { commitApplicationArtifact } = await import(
  "@/lib/server/applications/commitApplicationArtifact"
);

const aiContent: AiContent = {
  schemaVersion: 1,
  generatedAt: "2026-07-22T00:00:00.000Z",
  promptMetaHash: "sha256:test",
  cv: {
    summary: { aiText: "Summary", originalText: "Original", accepted: true },
    latestExperience: { experienceIndex: 0, addedBullets: [] },
  },
  cover: {
    paragraphOne: { aiText: "One", accepted: true },
    paragraphTwo: { aiText: "Two", accepted: true },
    paragraphThree: { aiText: "Three", accepted: true },
  },
};

const BASE = {
  userId: "user-1",
  job: { id: "job-1", title: "Engineer", company: "Joblit" },
  resumeProfileId: "profile-1",
  aiContent,
  status: "FINAL" as const,
};

const REVIEW_CONTEXT = {
  scopeKey: "user-1",
  resumeSnapshot: {
    summary: "Summary",
    skills: [{ label: "Languages", items: ["TypeScript"] }],
  },
  jobDescription: "Build reliable TypeScript systems.",
  jobSourceAvailable: true,
};

const resumeArtifact = {
  target: "resume" as const,
  pdf: Buffer.from("%PDF-1.7"),
  filename: "Ada Lovelace Engineer_CV.pdf",
  version: "v1",
};

const tailoringRequest = {
  handle: {
    id: "11111111-1111-4111-8111-111111111111",
    attemptId: "22222222-2222-4222-8222-222222222222",
  },
  source: "LOCAL_AI" as const,
  delivery: "FINAL" as const,
  target: "RESUME" as const,
  requestHash: "sha256:accept-resume-v1",
  promptHash: "sha256:prompt-resume-v1",
  resumeSnapshotHash: "sha256:resume-profile-v1",
  jobSnapshotHash: "sha256:job-v1",
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BLOB_READ_WRITE_TOKEN = "token";
  jobStore.findFirst.mockResolvedValue({ id: "job-1" });
  store.findUnique.mockResolvedValue(null);
  store.upsert.mockResolvedValue({ id: "application-1" });
  blob.put.mockResolvedValue({ url: "https://blob.example/new.pdf" });
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
});

describe("commitApplicationArtifact", () => {
  it("uploads, commits, and returns the hash the next write must send", async () => {
    const result = await commitApplicationArtifact({ ...BASE, artifacts: [resumeArtifact] });

    expect(result.kind).toBe("committed");
    if (result.kind !== "committed") return;
    expect(result.applicationId).toBe("application-1");
    expect(result.aiContentHash).toMatch(/^[a-f0-9]+$/);
    expect(result.urls.resume).toBe("https://blob.example/new.pdf");
  });

  it("takes the advisory lock before reading the row", async () => {
    const order: string[] = [];
    lock.acquireApplicationMutationLock.mockImplementation(() => void order.push("lock"));
    store.findUnique.mockImplementation(() => {
      order.push("read");
      return Promise.resolve(null);
    });

    await commitApplicationArtifact({ ...BASE, artifacts: [resumeArtifact] });

    expect(order).toEqual(["lock", "read"]);
  });

  it("aborts rather than clearing the previous PDF when the upload fails", async () => {
    // manual-generate used to report the failure and commit a null URL, which
    // wiped the user's existing artifact on any transient Blob outage.
    const cause = new Error("blob unavailable");
    blob.put.mockRejectedValueOnce(cause);

    const result = await commitApplicationArtifact({ ...BASE, artifacts: [resumeArtifact] });

    expect(result).toEqual({ kind: "upload_failed", cause });
    expect(store.upsert).not.toHaveBeenCalled();
  });

  it("deletes earlier uploads when a later artifact upload fails", async () => {
    const cause = new Error("cover upload failed");
    blob.put
      .mockResolvedValueOnce({ url: "https://blob.example/new-resume.pdf" })
      .mockRejectedValueOnce(cause);

    const result = await commitApplicationArtifact({
      ...BASE,
      artifacts: [
        resumeArtifact,
        {
          target: "cover",
          pdf: Buffer.from("%PDF-1.7"),
          version: "v1",
        },
      ],
    });

    expect(result).toEqual({ kind: "upload_failed", cause });
    expect(store.upsert).not.toHaveBeenCalled();
    expect(blob.del).toHaveBeenCalledWith(
      "https://blob.example/new-resume.pdf",
      { token: "token" },
    );
  });

  it("deletes the new blob when the compare-and-swap loses", async () => {
    store.findUnique.mockResolvedValue({
      resumePdfUrl: "https://blob.example/old.pdf",
      coverPdfUrl: null,
      aiContent: null,
      aiContentHash: "someone-else-wrote",
      atsValidation: null,
    });

    const result = await commitApplicationArtifact({
      ...BASE,
      artifacts: [resumeArtifact],
      expectedHash: "what-we-read",
    });

    expect(result).toEqual({ kind: "stale_write" });
    expect(store.upsert).not.toHaveBeenCalled();
    expect(blob.del).toHaveBeenCalledWith("https://blob.example/new.pdf", { token: "token" });
    // The superseded artifact survives a lost race.
    expect(blob.del).not.toHaveBeenCalledWith(
      "https://blob.example/old.pdf",
      expect.anything(),
    );
  });

  it("matches a row with no AI Content when expectedHash is null", async () => {
    store.findUnique.mockResolvedValue({
      resumePdfUrl: null,
      coverPdfUrl: null,
      aiContent: null,
      aiContentHash: null,
      atsValidation: null,
    });

    const result = await commitApplicationArtifact({
      ...BASE,
      artifacts: [resumeArtifact],
      expectedHash: null,
    });

    expect(result.kind).toBe("committed");
  });

  it("deletes the superseded blob only after the commit lands", async () => {
    store.findUnique.mockResolvedValue({
      resumePdfUrl: "https://blob.example/old.pdf",
      coverPdfUrl: null,
      aiContent: null,
      aiContentHash: null,
      atsValidation: null,
    });

    await commitApplicationArtifact({ ...BASE, artifacts: [resumeArtifact] });

    expect(store.upsert).toHaveBeenCalled();
    expect(blob.del).toHaveBeenCalledWith("https://blob.example/old.pdf", { token: "token" });
  });

  it("deletes the new blob when the transaction throws", async () => {
    const boom = new Error("constraint violation");
    store.upsert.mockRejectedValueOnce(boom);

    await expect(
      commitApplicationArtifact({ ...BASE, artifacts: [resumeArtifact] }),
    ).rejects.toThrow(boom);

    expect(blob.del).toHaveBeenCalledWith("https://blob.example/new.pdf", { token: "token" });
  });

  it("writes no artifact columns for a DRAFT commit", async () => {
    await commitApplicationArtifact(
      {
        ...BASE,
        status: "DRAFT",
        artifacts: [resumeArtifact],
      } as unknown as Parameters<typeof commitApplicationArtifact>[0],
    );

    const written = store.upsert.mock.calls[0]?.[0]?.update;
    expect(written).not.toHaveProperty("resumePdfUrl");
    expect(written.status).toBe("DRAFT");
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("commits without Blob configured rather than failing the request", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;

    const result = await commitApplicationArtifact({ ...BASE, artifacts: [resumeArtifact] });

    expect(result.kind).toBe("committed");
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("merges a single-target commit against the row so the other half survives", async () => {
    const stored: AiContent = {
      ...aiContent,
      cover: {
        paragraphOne: { aiText: "Existing cover", accepted: true },
        paragraphTwo: { aiText: "Two", accepted: true },
        paragraphThree: { aiText: "Three", accepted: true },
      },
    };
    store.findUnique.mockResolvedValue({
      resumePdfUrl: null,
      coverPdfUrl: null,
      aiContent: stored,
      aiContentHash: null,
      atsValidation: null,
    });

    await commitApplicationArtifact({
      ...BASE,
      mergeTarget: "resume",
      reviewContext: REVIEW_CONTEXT,
      artifacts: [resumeArtifact],
    });

    const written = store.upsert.mock.calls[0]?.[0]?.update.aiContent as AiContent;
    expect(written.cover.paragraphOne.aiText).toBe("Existing cover");
  });

  it("fails closed instead of overwriting an unknown stored schema", async () => {
    store.findUnique.mockResolvedValue({
      resumePdfUrl: null,
      coverPdfUrl: "https://blob.example/existing-cover.pdf",
      aiContent: {
        ...aiContent,
        schemaVersion: 999,
      },
      aiContentHash: null,
      atsValidation: null,
    });

    const result = await commitApplicationArtifact({
      ...BASE,
      mergeTarget: "resume",
      reviewContext: REVIEW_CONTEXT,
      artifacts: [resumeArtifact],
    });

    expect(result).toEqual({ kind: "invalid_ai_content" });
    expect(store.upsert).not.toHaveBeenCalled();
    expect(blob.del).toHaveBeenCalledWith("https://blob.example/new.pdf", {
      token: "token",
    });
    expect(blob.del).not.toHaveBeenCalledWith(
      "https://blob.example/existing-cover.pdf",
      expect.anything(),
    );
  });

  it("blocks a FINAL single-target commit when the preserved target fails review", async () => {
    const stored = structuredClone(aiContent);
    stored.cover.paragraphOne.aiText =
      "I increased revenue by 999% without supporting evidence.";
    store.findUnique.mockResolvedValue({
      resumePdfUrl: null,
      coverPdfUrl: "https://blob.example/existing-cover.pdf",
      aiContent: stored,
      aiContentHash: null,
      atsValidation: null,
    });

    const result = await commitApplicationArtifact({
      ...BASE,
      mergeTarget: "resume",
      reviewContext: REVIEW_CONTEXT,
      artifacts: [resumeArtifact],
    });

    expect(result.kind).toBe("review_blocked");
    if (result.kind !== "review_blocked") return;
    expect(result.review.issues.join(" ")).toContain("999%");
    expect(store.upsert).not.toHaveBeenCalled();
    expect(blob.del).toHaveBeenCalledWith("https://blob.example/new.pdf", {
      token: "token",
    });
    expect(blob.del).not.toHaveBeenCalledWith(
      "https://blob.example/existing-cover.pdf",
      expect.anything(),
    );
  });

  it("persists a blocked aggregate as DRAFT so the user can resolve it", async () => {
    const stored = structuredClone(aiContent);
    stored.cover.paragraphOne.aiText =
      "I increased revenue by 999% without supporting evidence.";
    store.findUnique.mockResolvedValue({
      resumePdfUrl: null,
      coverPdfUrl: null,
      aiContent: stored,
      aiContentHash: null,
      atsValidation: null,
    });

    const result = await commitApplicationArtifact({
      ...BASE,
      status: "DRAFT",
      mergeTarget: "resume",
      reviewContext: REVIEW_CONTEXT,
      artifacts: [],
    });

    expect(result.kind).toBe("committed");
    const written = store.upsert.mock.calls[0]?.[0]?.update.aiContent as AiContent;
    expect(written.review?.verdict).toBe("blocked");
  });

  it("reports a Job deleted mid-render instead of hitting the foreign key", async () => {
    jobStore.findFirst.mockResolvedValue(null);

    const result = await commitApplicationArtifact({ ...BASE, artifacts: [resumeArtifact] });

    expect(result).toEqual({ kind: "job_missing" });
    expect(store.upsert).not.toHaveBeenCalled();
    expect(blob.del).toHaveBeenCalledWith("https://blob.example/new.pdf", { token: "token" });
  });

  it("persists the review ledger inside the transaction", async () => {
    await commitApplicationArtifact({ ...BASE, artifacts: [resumeArtifact] });

    expect(ledger.persistReviewLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        applicationId: "application-1",
        jobId: "job-1",
      }),
    );
  });

  it("accepts a Tailoring Run around the Application commit in one transaction", async () => {
    const order: string[] = [];
    const prepared = {
      userId: "user-1",
      pending: [tailoringRequest],
      replayed: [],
      runs: [],
    };
    tailoringAcceptance.prepareTailoringRunAcceptance.mockImplementationOnce(
      async () => {
        order.push("prepare");
        return prepared;
      },
    );
    lock.acquireApplicationMutationLock.mockImplementationOnce(() => {
      order.push("joba-lock");
    });
    store.upsert.mockImplementationOnce(async () => {
      order.push("application");
      return { id: "application-1" };
    });
    ledger.persistReviewLedger.mockImplementationOnce(async () => {
      order.push("review-ledger");
    });
    tailoringAcceptance.completeTailoringRunAcceptance.mockImplementationOnce(
      async () => {
        order.push("complete");
        return { receipts: [], completedRunIds: [] };
      },
    );

    const result = await commitApplicationArtifact({
      ...BASE,
      artifacts: [resumeArtifact],
      tailoring: [tailoringRequest],
    });

    expect(result.kind).toBe("committed");
    if (result.kind !== "committed") return;
    expect(result.tailoringDisposition).toBe("APPLIED");
    expect(order).toEqual([
      "prepare",
      "joba-lock",
      "application",
      "review-ledger",
      "complete",
    ]);

    const transactionClient =
      tailoringAcceptance.prepareTailoringRunAcceptance.mock.calls[0]?.[0];
    expect(transactionClient).toBeDefined();
    expect(lock.acquireApplicationMutationLock.mock.calls[0]?.[0]).toBe(
      transactionClient,
    );
    expect(ledger.persistReviewLedger.mock.calls[0]?.[0]).toBe(
      transactionClient,
    );
    expect(
      tailoringAcceptance.completeTailoringRunAcceptance.mock.calls[0]?.[0],
    ).toBe(transactionClient);
    expect(
      tailoringAcceptance.prepareTailoringRunAcceptance.mock.calls[0]?.[1],
    ).toEqual({
      userId: "user-1",
      jobId: "job-1",
      resumeProfileId: "profile-1",
      requests: [tailoringRequest],
    });
    expect(
      tailoringAcceptance.completeTailoringRunAcceptance.mock.calls[0]?.[1],
    ).toEqual({
      prepared,
      applicationId: "application-1",
      aiContentHash: result.aiContentHash,
    });
  });

  it("replays a receipt-backed acceptance without rewriting the Application", async () => {
    const replayed = {
      runId: tailoringRequest.handle.id,
      target: tailoringRequest.target,
      executionAttemptId: tailoringRequest.handle.attemptId,
      requestHash: tailoringRequest.requestHash,
      applicationId: "application-existing",
      aiContentHash: "sha256:persisted-ai-content",
      delivery: tailoringRequest.delivery,
    };
    tailoringAcceptance.prepareTailoringRunAcceptance.mockResolvedValueOnce({
      userId: "user-1",
      pending: [],
      replayed: [replayed],
      runs: [],
    });
    store.findUnique.mockResolvedValueOnce({
      id: "application-existing",
      resumePdfUrl: "https://blob.example/current-resume.pdf",
      coverPdfUrl: "https://blob.example/current-cover.pdf",
      aiContent,
      aiContentHash: "sha256:persisted-ai-content",
      atsValidation: null,
    });

    const result = await commitApplicationArtifact({
      ...BASE,
      artifacts: [resumeArtifact],
      tailoring: [tailoringRequest],
    });

    expect(result).toEqual({
      kind: "committed",
      applicationId: "application-existing",
      aiContent,
      aiContentHash: "sha256:persisted-ai-content",
      urls: {
        resume: "https://blob.example/current-resume.pdf",
        cover: "https://blob.example/current-cover.pdf",
      },
      tailoringDisposition: "REPLAYED",
    });
    expect(store.upsert).not.toHaveBeenCalled();
    expect(ledger.persistReviewLedger).not.toHaveBeenCalled();
    expect(
      tailoringAcceptance.completeTailoringRunAcceptance,
    ).not.toHaveBeenCalled();
    expect(blob.del).toHaveBeenCalledWith("https://blob.example/new.pdf", {
      token: "token",
    });
    expect(blob.del).not.toHaveBeenCalledWith(
      "https://blob.example/current-resume.pdf",
      expect.anything(),
    );
  });

  it("aborts an acceptance conflict before Application mutation and cleans the upload", async () => {
    const conflict = new Error("TAILORING_RUN_RECEIPT_CONFLICT");
    tailoringAcceptance.prepareTailoringRunAcceptance.mockRejectedValueOnce(
      conflict,
    );

    await expect(
      commitApplicationArtifact({
        ...BASE,
        artifacts: [resumeArtifact],
        tailoring: [tailoringRequest],
      }),
    ).rejects.toBe(conflict);

    expect(lock.acquireApplicationMutationLock).not.toHaveBeenCalled();
    expect(store.upsert).not.toHaveBeenCalled();
    expect(ledger.persistReviewLedger).not.toHaveBeenCalled();
    expect(
      tailoringAcceptance.completeTailoringRunAcceptance,
    ).not.toHaveBeenCalled();
    expect(blob.del).toHaveBeenCalledWith("https://blob.example/new.pdf", {
      token: "token",
    });
  });

  it("rejects the transaction when acceptance completion conflicts after the write", async () => {
    const conflict = new Error("TAILORING_RUN_RECEIPT_CONFLICT");
    tailoringAcceptance.completeTailoringRunAcceptance.mockRejectedValueOnce(
      conflict,
    );

    await expect(
      commitApplicationArtifact({
        ...BASE,
        artifacts: [resumeArtifact],
        tailoring: [tailoringRequest],
      }),
    ).rejects.toBe(conflict);

    // These calls are staged inside the rejected transaction. Letting the
    // completion error escape is what makes Prisma roll them back together.
    expect(store.upsert).toHaveBeenCalledOnce();
    expect(ledger.persistReviewLedger).toHaveBeenCalledOnce();
    expect(
      tailoringAcceptance.completeTailoringRunAcceptance,
    ).toHaveBeenCalledOnce();
    expect(blob.del).toHaveBeenCalledWith("https://blob.example/new.pdf", {
      token: "token",
    });
  });
});
