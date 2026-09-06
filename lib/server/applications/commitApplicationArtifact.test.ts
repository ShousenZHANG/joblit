import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashAiContent, type AiContent } from "@/lib/shared/schemas/aiContent";
import {
  buildApplicationPublicationRenderContext,
  hashApplicationDocumentContent,
} from "@/lib/server/applications/applicationPublication";

const blob = vi.hoisted(() => ({ put: vi.fn(), del: vi.fn() }));
const store = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn() }));
const jobStore = vi.hoisted(() => ({ findFirst: vi.fn() }));
const database = vi.hoisted(() => ({
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
}));
const lock = vi.hoisted(() => ({ acquireApplicationMutationLock: vi.fn() }));
const lifecycle = vi.hoisted(() => ({
  stageApplicationArtifact: vi.fn(),
  recordUploadedArtifact: vi.fn(),
  markArtifactsReferencedAndRetireSuperseded: vi.fn(),
  retireStagedArtifacts: vi.fn(),
}));

vi.mock("@vercel/blob", () => blob);
vi.mock("@/lib/server/artifacts/applicationArtifactLifecycle", () => lifecycle);
vi.mock("@/lib/server/applications/applicationMutationLock", () => lock);
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    application: store,
    // The fake `tx` exposes only what the module is allowed to touch, so a new
    // dependency shows up as a failure rather than passing silently.
    $transaction: database.transaction,
  },
}));

const { commitApplicationArtifact } =
  await import("@/lib/server/applications/commitApplicationArtifact");

const aiContent: AiContent = {
  schemaVersion: 2,
  generatedAt: "2026-07-22T00:00:00.000Z",
  promptMetaHash: "sha256:test",
  cv: {
    summary: { aiText: "Summary", originalText: "Original", accepted: true },
    skillsSelection: { aiSelection: [{ group: 0, items: [0] }] },
  },
  cover: {
    paragraphOne: { aiText: "One", accepted: true },
    paragraphTwo: { aiText: "Two", accepted: true },
    paragraphThree: { aiText: "Three", accepted: true },
  },
};

const PROFILE_RENDER_SOURCE = {
  summary: "Profile summary",
  basics: {
    fullName: "Ada Lovelace",
    title: "Engineer",
    email: "ada@example.com",
    phone: "+61 400 000 000",
  },
  links: null,
  skills: [{ category: "Core", items: ["TypeScript"] }],
  experiences: null,
  projects: null,
  education: null,
};

const JOB_RENDER_SOURCE = {
  title: "Engineer",
  company: "Joblit",
  market: "AU",
};

function lockedRenderSource(
  overrides: Partial<{
    profileSummary: string | null;
    profileBasics: unknown;
    profileSkills: unknown;
    jobTitle: string;
    jobCompany: string | null;
    jobMarket: string;
  }> = {},
) {
  return {
    profileSummary: PROFILE_RENDER_SOURCE.summary,
    profileBasics: PROFILE_RENDER_SOURCE.basics,
    profileLinks: PROFILE_RENDER_SOURCE.links,
    profileSkills: PROFILE_RENDER_SOURCE.skills,
    profileExperiences: PROFILE_RENDER_SOURCE.experiences,
    profileProjects: PROFILE_RENDER_SOURCE.projects,
    profileEducation: PROFILE_RENDER_SOURCE.education,
    jobTitle: JOB_RENDER_SOURCE.title,
    jobCompany: JOB_RENDER_SOURCE.company,
    jobMarket: JOB_RENDER_SOURCE.market,
    ...overrides,
  };
}

const BASE = {
  userId: "user-1",
  job: { id: "job-1", title: "Engineer", company: "Joblit" },
  resumeProfileId: "profile-1",
  aiContent,
  publicationRenderContext: buildApplicationPublicationRenderContext({
    profile: PROFILE_RENDER_SOURCE,
    job: JOB_RENDER_SOURCE,
  }),
  status: "FINAL" as const,
};

const resumeArtifact = {
  target: "resume" as const,
  pdf: Buffer.from("%PDF-1.7"),
  filename: "Ada Lovelace Engineer_CV.pdf",
};

const coverArtifact = {
  target: "cover" as const,
  pdf: Buffer.from("%PDF-1.7 cover"),
};

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "token");
  database.transaction.mockImplementation((fn) =>
    fn({
      application: store,
      job: jobStore,
      $executeRaw: database.executeRaw,
      $queryRaw: database.queryRaw,
    }),
  );
  database.executeRaw.mockReset().mockResolvedValue(0);
  database.queryRaw.mockReset().mockResolvedValue([lockedRenderSource()]);
  jobStore.findFirst.mockResolvedValue({ id: "job-1" });
  store.findUnique.mockResolvedValue(null);
  store.upsert.mockResolvedValue({ id: "application-1" });
  blob.put.mockResolvedValue({ url: "https://blob.example/new.pdf" });
  lifecycle.stageApplicationArtifact.mockImplementation(async (input) => {
    const stem = input.target === "RESUME_PDF" ? "resume" : "cover";
    const sequence = lifecycle.stageApplicationArtifact.mock.calls.length;
    const pathname =
      `applications/${input.userId}/${input.jobId}/` +
      `${stem}.${input.contentVersion}-1234abcd-${"0".repeat(64)}.pdf`;
    return {
      disposition: "STAGED",
      pathname,
      contentHash: "0".repeat(64),
      artifact: {
        id: `artifact-${sequence}`,
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
  lifecycle.recordUploadedArtifact.mockImplementation(async (input) => ({
    disposition: "RECORDED",
    artifact: {
      id: input.artifactId,
      state: "STAGED",
      pathname: input.pathname,
      url: input.url,
    },
  }));
  lifecycle.markArtifactsReferencedAndRetireSuperseded.mockResolvedValue({
    referenced: 1,
    retired: 0,
  });
  lifecycle.retireStagedArtifacts.mockResolvedValue({
    queued: 1,
    awaitingUploadResolution: 0,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("commitApplicationArtifact", () => {
  it("fences a scoped receipt under JOBA before any application write and records it in that transaction", async () => {
    const events: string[] = [];
    lock.acquireApplicationMutationLock.mockImplementationOnce(async () => { events.push("lock"); });
    const assertCurrent = vi.fn(async (_tx: unknown) => { events.push("fence"); });
    store.upsert.mockImplementationOnce(async () => { events.push("application"); return { id: "application-1" }; });
    const record = vi.fn(async (_tx: unknown, _result: unknown) => { events.push("receipt"); });
    const result = await commitApplicationArtifact({ ...BASE, artifacts: [resumeArtifact], receipt: { assertCurrent, record } });
    expect(result.kind).toBe("committed");
    expect(events).toEqual(["lock", "fence", "application", "receipt"]);
    expect(record.mock.calls[0]?.[0]).toBe(assertCurrent.mock.calls[0]?.[0]);
    expect(record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ applicationId: "application-1", urls: { resume: "https://blob.example/new.pdf" } }));
    expect(database.transaction).toHaveBeenCalledTimes(1);
  });

  it("a cancelled or superseded receipt refuses the application write and retires the staged upload", async () => {
    const record = vi.fn();
    await expect(commitApplicationArtifact({ ...BASE, artifacts: [resumeArtifact], receipt: {
      assertCurrent: async () => { throw new Error("task cancelled"); }, record,
    } })).rejects.toThrow("task cancelled");
    expect(store.upsert).not.toHaveBeenCalled(); expect(record).not.toHaveBeenCalled();
    expect(lifecycle.retireStagedArtifacts).toHaveBeenCalledWith(expect.objectContaining({ artifactIds: ["artifact-1"] }));
  });

  it("does not report success if its atomic receipt write fails", async () => {
    let committed = false;
    database.transaction.mockImplementationOnce(async fn => {
      const result = await fn({ application: store, job: jobStore, $executeRaw: database.executeRaw, $queryRaw: database.queryRaw });
      committed = true;
      return result;
    });
    await expect(commitApplicationArtifact({ ...BASE, artifacts: [resumeArtifact], receipt: {
      assertCurrent: async () => {}, record: async () => { throw new Error("receipt unavailable"); },
    } })).rejects.toThrow("receipt unavailable");
    expect(committed).toBe(false);
    expect(lifecycle.retireStagedArtifacts).toHaveBeenCalled();
  });

  it.each([
    ["resume", resumeArtifact],
    ["cover", coverArtifact],
  ] as const)(
    "rejects a duplicate %s target before any artifact, Blob, or database side effect",
    async (target, artifact) => {
      const result = await commitApplicationArtifact({
        ...BASE,
        artifacts: [
          artifact,
          { ...artifact, pdf: Buffer.from("%PDF duplicate") },
        ],
      });

      expect(result).toMatchObject({
        kind: "upload_failed",
        cause: {
          code: "DUPLICATE_APPLICATION_ARTIFACT_TARGET",
          message: `Duplicate application artifact target: ${target}`,
        },
      });
      expect(lifecycle.stageApplicationArtifact).not.toHaveBeenCalled();
      expect(blob.put).not.toHaveBeenCalled();
      expect(database.transaction).not.toHaveBeenCalled();
    },
  );

  it("rejects an artifact outside a single-target proposal replacement", async () => {
    const result = await commitApplicationArtifact({
      ...BASE,
      mergeTarget: "resume",
      artifacts: [coverArtifact],
    });

    expect(result).toEqual({ kind: "invalid_ai_content" });
    expect(lifecycle.stageApplicationArtifact).not.toHaveBeenCalled();
  });

  it("preserves a valid resume and cover commit", async () => {
    const result = await commitApplicationArtifact({
      ...BASE,
      artifacts: [resumeArtifact, coverArtifact],
    });

    expect(result.kind).toBe("committed");
    expect(lifecycle.stageApplicationArtifact).toHaveBeenCalledTimes(2);
    expect(blob.put).toHaveBeenCalledTimes(2);
    expect(database.transaction).toHaveBeenCalledTimes(1);
  });

  it("uploads, commits, and returns the hash the next write must send", async () => {
    const result = await commitApplicationArtifact({
      ...BASE,
      artifacts: [resumeArtifact],
    });

    expect(result.kind).toBe("committed");
    if (result.kind !== "committed") return;
    expect(result.applicationId).toBe("application-1");
    expect(result.aiContentHash).toMatch(/^[a-f0-9]+$/);
    expect(result.urls.resume).toBe("https://blob.example/new.pdf");
    expect(lifecycle.stageApplicationArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        jobId: "job-1",
        target: "RESUME_PDF",
        contentVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(blob.put).toHaveBeenCalledWith(
      expect.stringMatching(
        /^applications\/user-1\/job-1\/resume\.[a-f0-9]{64}-[a-f0-9]{8}-[a-f0-9]{64}\.pdf$/,
      ),
      resumeArtifact.pdf,
      {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/pdf",
        token: "token",
      },
    );
    expect(lifecycle.recordUploadedArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: "artifact-1",
        userId: "user-1",
        url: "https://blob.example/new.pdf",
      }),
    );
  });

  it("takes the advisory lock before reading the row", async () => {
    const order: string[] = [];
    lock.acquireApplicationMutationLock.mockImplementation(
      () => void order.push("lock"),
    );
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

    const result = await commitApplicationArtifact({
      ...BASE,
      artifacts: [resumeArtifact],
    });

    expect(result).toEqual({ kind: "upload_failed", cause });
    expect(store.upsert).not.toHaveBeenCalled();
    expect(lifecycle.retireStagedArtifacts).toHaveBeenCalledWith({
      userId: "user-1",
      jobId: "job-1",
      artifactIds: ["artifact-1"],
    });
    expect(blob.del).not.toHaveBeenCalled();
  });

  it("durably retires every stage when a later artifact upload fails", async () => {
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
        },
      ],
    });

    expect(result).toEqual({ kind: "upload_failed", cause });
    expect(store.upsert).not.toHaveBeenCalled();
    expect(lifecycle.retireStagedArtifacts).toHaveBeenCalledWith({
      userId: "user-1",
      jobId: "job-1",
      artifactIds: ["artifact-1", "artifact-2"],
    });
    expect(blob.del).not.toHaveBeenCalled();
  });

  it("durably retires the new blob when the compare-and-swap loses", async () => {
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
    expect(lifecycle.retireStagedArtifacts).toHaveBeenCalledWith({
      userId: "user-1",
      jobId: "job-1",
      artifactIds: ["artifact-1"],
    });
    expect(
      lifecycle.markArtifactsReferencedAndRetireSuperseded,
    ).not.toHaveBeenCalled();
  });

  it.each([
    [
      "Profile",
      {
        profileBasics: {
          ...PROFILE_RENDER_SOURCE.basics,
          fullName: "Grace Hopper",
        },
      },
      resumeArtifact,
    ],
    ["Job", { jobTitle: "Principal Engineer" }, coverArtifact],
  ] as const)(
    "fences a rendered artifact when the %s context changes before commit",
    async (_source, override, artifact) => {
      database.queryRaw.mockResolvedValueOnce([lockedRenderSource(override)]);

      const result = await commitApplicationArtifact({
        ...BASE,
        artifacts: [artifact],
      });

      expect(result).toEqual({ kind: "stale_render_context" });
      expect(store.upsert).not.toHaveBeenCalled();
      expect(lifecycle.retireStagedArtifacts).toHaveBeenCalledWith({
        userId: "user-1",
        jobId: "job-1",
        artifactIds: ["artifact-1"],
      });
      expect(
        lifecycle.markArtifactsReferencedAndRetireSuperseded,
      ).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["Resume", resumeArtifact, { jobTitle: "Principal Engineer" }],
    [
      "Cover",
      coverArtifact,
      { profileSkills: [{ category: "Core", items: ["Rust"] }] },
    ],
  ] as const)(
    "ignores a %s-irrelevant render-context change",
    async (_target, artifact, override) => {
      database.queryRaw.mockResolvedValueOnce([lockedRenderSource(override)]);

      const result = await commitApplicationArtifact({
        ...BASE,
        artifacts: [artifact],
      });

      expect(result.kind).toBe("committed");
      expect(store.upsert).toHaveBeenCalledOnce();
    },
  );

  it("reprojects the untouched target from the latest locked context", async () => {
    const previousResumeHash = hashApplicationDocumentContent(
      aiContent,
      "resume",
      BASE.publicationRenderContext,
    );
    const previousCoverHash = hashApplicationDocumentContent(
      aiContent,
      "cover",
      BASE.publicationRenderContext,
    );
    store.findUnique.mockResolvedValueOnce({
      id: "application-1",
      resumePdfUrl: "https://blob.example/current-resume.pdf",
      coverPdfUrl: "https://blob.example/current-cover.pdf",
      aiContent,
      aiContentHash: hashAiContent(aiContent),
      atsValidation: null,
      status: "FINAL",
      resumeContentHash: previousResumeHash,
      resumePublishedHash: previousResumeHash,
      coverContentHash: previousCoverHash,
      coverPublishedHash: previousCoverHash,
    });
    database.queryRaw.mockResolvedValueOnce([
      lockedRenderSource({
        profileSkills: [{ category: "Core", items: ["Rust"] }],
      }),
    ]);

    const result = await commitApplicationArtifact({
      ...BASE,
      artifacts: [coverArtifact],
    });

    expect(result.kind).toBe("committed");
    if (result.kind !== "committed") return;
    expect(result.publication).toMatchObject({
      status: "DRAFT",
      resume: { status: "DRAFT" },
      cover: { status: "FINAL" },
    });
    expect(store.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          resumeContentHash: expect.not.stringMatching(
            new RegExp(`^${previousResumeHash}$`),
          ),
          resumePublishedHash: previousResumeHash,
          coverContentHash: previousCoverHash,
          coverPublishedHash: previousCoverHash,
        }),
      }),
    );
  });

  it("fences a content-only DRAFT when a persisted publication input changes", async () => {
    database.queryRaw.mockResolvedValueOnce([
      lockedRenderSource({ jobTitle: "Principal Engineer" }),
    ]);

    const result = await commitApplicationArtifact({
      ...BASE,
      status: "DRAFT",
      artifacts: [],
    });

    expect(result).toEqual({ kind: "stale_render_context" });
    expect(store.upsert).not.toHaveBeenCalled();
  });

  it("holds shared Profile and Job row locks from context comparison through publication", async () => {
    const order: string[] = [];
    database.queryRaw.mockImplementationOnce((strings) => {
      order.push("render-context-lock");
      const sql = strings.join(" ");
      expect(sql).toContain("FOR SHARE OF job, profile");
      return Promise.resolve([lockedRenderSource()]);
    });
    store.upsert.mockImplementationOnce(async () => {
      order.push("publish");
      return { id: "application-1" };
    });

    const result = await commitApplicationArtifact({
      ...BASE,
      artifacts: [resumeArtifact],
    });

    expect(result.kind).toBe("committed");
    expect(order).toEqual(["render-context-lock", "publish"]);
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

  it("upserts the Application before retiring the superseded blob in the same transaction", async () => {
    store.findUnique.mockResolvedValue({
      resumePdfUrl: "https://blob.example/old.pdf",
      coverPdfUrl: null,
      aiContent: null,
      aiContentHash: null,
      atsValidation: null,
    });

    await commitApplicationArtifact({ ...BASE, artifacts: [resumeArtifact] });

    expect(store.upsert).toHaveBeenCalled();
    expect(
      lifecycle.markArtifactsReferencedAndRetireSuperseded,
    ).toHaveBeenCalledWith(
      lock.acquireApplicationMutationLock.mock.calls[0]?.[0],
      {
        userId: "user-1",
        jobId: "job-1",
        applicationId: "application-1",
        referenced: [
          expect.objectContaining({
            target: "RESUME_PDF",
            url: "https://blob.example/new.pdf",
          }),
        ],
        superseded: [
          {
            target: "RESUME_PDF",
            url: "https://blob.example/old.pdf",
          },
        ],
      },
    );
    expect(store.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      lifecycle.markArtifactsReferencedAndRetireSuperseded.mock
        .invocationCallOrder[0],
    );
    expect(blob.del).not.toHaveBeenCalled();
  });

  it("durably retires the new blob when the transaction throws", async () => {
    const boom = new Error("constraint violation");
    store.upsert.mockRejectedValueOnce(boom);

    await expect(
      commitApplicationArtifact({ ...BASE, artifacts: [resumeArtifact] }),
    ).rejects.toThrow(boom);

    expect(lifecycle.retireStagedArtifacts).toHaveBeenCalledWith({
      userId: "user-1",
      jobId: "job-1",
      artifactIds: ["artifact-1"],
    });
    expect(blob.del).not.toHaveBeenCalled();
  });

  it("writes no artifact columns for a DRAFT commit", async () => {
    await commitApplicationArtifact({
      ...BASE,
      status: "DRAFT",
      artifacts: [resumeArtifact],
    } as unknown as Parameters<typeof commitApplicationArtifact>[0]);

    const written = store.upsert.mock.calls[0]?.[0]?.update;
    expect(written).not.toHaveProperty("resumePdfUrl");
    expect(written.status).toBe("DRAFT");
    expect(blob.put).not.toHaveBeenCalled();
    expect(lifecycle.stageApplicationArtifact).not.toHaveBeenCalled();
  });

  it.each(["production", "development"])(
    "fails closed in %s before staging FINAL when Blob is not configured",
    async (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");

      const result = await commitApplicationArtifact({
        ...BASE,
        artifacts: [resumeArtifact],
      });

      expect(result).toEqual({ kind: "blob_not_configured" });
      expect(blob.put).not.toHaveBeenCalled();
      expect(lifecycle.stageApplicationArtifact).not.toHaveBeenCalled();
    },
  );

  it("keeps DRAFT content-only commits working without Blob configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");

    const result = await commitApplicationArtifact({
      ...BASE,
      status: "DRAFT",
      artifacts: [],
    });

    expect(result.kind).toBe("committed");
    expect(store.upsert).toHaveBeenCalledOnce();
    expect(blob.put).not.toHaveBeenCalled();
    expect(lifecycle.stageApplicationArtifact).not.toHaveBeenCalled();
  });

  it("publishes only the committed document and derives aggregate status", async () => {
    const result = await commitApplicationArtifact({
      ...BASE,
      artifacts: [resumeArtifact],
    });

    expect(result.kind).toBe("committed");
    if (result.kind !== "committed") return;
    expect(result.publication.resume.status).toBe("FINAL");
    expect(result.publication.cover.status).toBe("DRAFT");
    expect(result.publication.status).toBe("DRAFT");
    expect(store.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: "DRAFT",
          resumeContentHash: expect.any(String),
          resumePublishedHash: expect.any(String),
          coverContentHash: expect.any(String),
          coverPublishedHash: null,
        }),
      }),
    );
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
      artifacts: [resumeArtifact],
    });

    const written = store.upsert.mock.calls[0]?.[0]?.update
      .aiContent as AiContent;
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
      artifacts: [resumeArtifact],
    });

    expect(result).toEqual({ kind: "invalid_ai_content" });
    expect(store.upsert).not.toHaveBeenCalled();
    expect(lifecycle.retireStagedArtifacts).toHaveBeenCalledWith({
      userId: "user-1",
      jobId: "job-1",
      artifactIds: ["artifact-1"],
    });
    expect(blob.del).not.toHaveBeenCalled();
  });


  it("reports a Job deleted mid-render instead of hitting the foreign key", async () => {
    jobStore.findFirst.mockResolvedValue(null);

    const result = await commitApplicationArtifact({
      ...BASE,
      artifacts: [resumeArtifact],
    });

    expect(result).toEqual({ kind: "job_missing" });
    expect(store.upsert).not.toHaveBeenCalled();
    expect(lifecycle.retireStagedArtifacts).toHaveBeenCalledWith({
      userId: "user-1",
      jobId: "job-1",
      artifactIds: ["artifact-1"],
    });
    expect(blob.del).not.toHaveBeenCalled();
  });

  it("preserves the stored skills selection when merging the other target", async () => {
    // A cover import must not retailor the resume: the selection the resume
    // PDF was published against has to survive untouched.
    const stored = structuredClone(aiContent);
    stored.cv.skillsSelection = {
      aiSelection: [{ group: 0, items: [0] }],
      userSelection: [{ group: 0, items: [0] }],
    };
    store.findUnique.mockResolvedValue({
      resumePdfUrl: "https://blob.example/existing-resume.pdf",
      coverPdfUrl: null,
      aiContent: stored,
      aiContentHash: null,
      atsValidation: null,
    });

    await commitApplicationArtifact({
      ...BASE,
      mergeTarget: "cover",
      artifacts: [coverArtifact],
    });

    const written = store.upsert.mock.calls[0]?.[0]?.update
      .aiContent as AiContent;
    expect(written.cv.skillsSelection).toEqual(stored.cv.skillsSelection);
  });
});
