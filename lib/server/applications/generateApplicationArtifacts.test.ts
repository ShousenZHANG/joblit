import { beforeEach, describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => ({
  job: {
    findFirst: vi.fn(),
  },
  application: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  executeRaw: vi.fn(),
  transaction: vi.fn(),
  operations: [] as string[],
}));
const dependencies = vi.hoisted(() => ({
  buildResumePdfForJob: vi.fn(),
  compileLatexToPdf: vi.fn(),
  getResumeProfile: vi.fn(),
  renderCoverLetterTex: vi.fn(),
  tailorApplicationContent: vi.fn(),
}));
const blob = vi.hoisted(() => ({
  del: vi.fn(),
  put: vi.fn(),
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
vi.mock("@vercel/blob", () => blob);

import { generateApplicationArtifactsForJob } from "./generateApplicationArtifacts";

const job = {
  id: "job-1",
  title: "Engineer",
  company: "Joblit",
  description: "Build reliable systems",
  market: "AU",
};

describe("generateApplicationArtifactsForJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
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
    stores.transaction.mockImplementation(async (callback) =>
      callback({
        $executeRaw: stores.executeRaw,
        job: {
          findFirst: vi.fn(async () => {
            stores.operations.push("job.findFirst");
            return { id: job.id };
          }),
        },
        application: stores.application,
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
    });
    dependencies.tailorApplicationContent.mockResolvedValue({
      cover: {
        paragraphOne: "One",
        paragraphTwo: "Two",
        paragraphThree: "Three",
      },
    });
    dependencies.renderCoverLetterTex.mockReturnValue("cover tex");
    dependencies.compileLatexToPdf.mockResolvedValue(Buffer.from("cover"));
    blob.put
      .mockResolvedValueOnce({ url: "https://blob/new-resume.pdf" })
      .mockResolvedValueOnce({ url: "https://blob/new-cover.pdf" });
    blob.del.mockResolvedValue(undefined);
  });

  it("locks, rechecks ownership, commits, then deletes only stale artifacts", async () => {
    const result = await generateApplicationArtifactsForJob({
      userId: "user-1",
      jobId: job.id,
    });

    expect(result.applicationId).toBe("application-1");
    expect(stores.operations).toEqual([
      "application.lock",
      "job.findFirst",
      "application.findUnique",
      "application.upsert",
    ]);
    expect(blob.del).toHaveBeenCalledWith(
      "https://blob/old-resume.pdf",
      { token: "blob-token" },
    );
    expect(blob.del).toHaveBeenCalledWith(
      "https://blob/old-cover.pdf",
      { token: "blob-token" },
    );
    expect(blob.del).not.toHaveBeenCalledWith(
      "https://blob/new-resume.pdf",
      expect.anything(),
    );
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
      }),
    );

    await expect(
      generateApplicationArtifactsForJob({
        userId: "user-1",
        jobId: job.id,
      }),
    ).rejects.toThrow("JOB_NOT_FOUND");

    expect(stores.application.upsert).not.toHaveBeenCalled();
    expect(blob.del).toHaveBeenCalledWith(
      "https://blob/new-resume.pdf",
      { token: "blob-token" },
    );
    expect(blob.del).toHaveBeenCalledWith(
      "https://blob/new-cover.pdf",
      { token: "blob-token" },
    );
  });

  it("rolls back newly uploaded artifacts when the commit fails", async () => {
    stores.application.upsert.mockRejectedValueOnce(new Error("DB_DOWN"));

    await expect(
      generateApplicationArtifactsForJob({
        userId: "user-1",
        jobId: job.id,
      }),
    ).rejects.toThrow("DB_DOWN");

    expect(blob.del).toHaveBeenCalledWith(
      "https://blob/new-resume.pdf",
      { token: "blob-token" },
    );
    expect(blob.del).toHaveBeenCalledWith(
      "https://blob/new-cover.pdf",
      { token: "blob-token" },
    );
  });
});
