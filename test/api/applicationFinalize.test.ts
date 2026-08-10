import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  application: {
    findFirst: vi.fn(),
  },
}));
const renderer = vi.hoisted(() => ({
  buildAtsKeywords: vi.fn(() => []),
  renderApplicationPdf: vi.fn(),
  renderCoverLetterPdf: vi.fn(),
}));
const commit = vi.hoisted(() => ({
  APPLICATION_ARTIFACT_STORAGE_UNAVAILABLE: {
    code: "ARTIFACT_STORAGE_UNAVAILABLE",
    status: 503,
    message:
      "PDF storage is not configured. Please try again after deployment configuration is restored.",
  },
  commitApplicationArtifact: vi.fn(),
}));
const publicationReplay = vi.hoisted(() => ({
  confirmApplicationPublicationReplay: vi.fn(),
}));
const ats = vi.hoisted(() => ({ assertAtsPdf: vi.fn() }));
const renderLimiter = vi.hoisted(() => ({
  enforce: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: { application: prisma.application },
}));
vi.mock("@/lib/server/applications/finalizeApplication", () => renderer);
/**
 * The blob lifecycle and the compare-and-swap moved into
 * `commitApplicationArtifact` and are covered by its own tests — including
 * that a lost CAS durably retires the new Blob and spares the current one, and
 * that a throwing transaction preserves the same retirement intent. What remains here is
 * route-level: the pre-checks, the idempotent short-circuit, the review gate,
 * and mapping commit results onto responses.
 */
vi.mock("@/lib/server/applications/commitApplicationArtifact", () => commit);
vi.mock(
  "@/lib/server/applications/applicationPublicationReplay",
  () => publicationReplay,
);
vi.mock("@/lib/server/applications/atsPdfValidator", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/applications/atsPdfValidator")>()),
  assertAtsPdf: ats.assertAtsPdf,
}));
vi.mock("@/lib/server/api/applicationRenderRateLimit", () => ({
  enforceApplicationRenderRateLimit: renderLimiter.enforce,
}));
vi.mock("@/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/applications/[id]/finalize/route";
import {
  AI_CONTENT_SCHEMA_VERSION,
  hashAiContent,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";
import { attachEvidenceAndReview } from "@/lib/server/ai/evidenceLedger";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import {
  buildApplicationPublicationRenderContext,
  hashApplicationDocumentContent,
} from "@/lib/server/applications/applicationPublication";

const APP_ID = "22222222-2222-4222-9222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const ATTEMPT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "user-1";
const PROFILE = {
  id: "profile-linked",
  userId: USER_ID,
  summary: "Built reliable TypeScript APIs.",
  basics: null,
  links: null,
  skills: null,
  experiences: null,
  projects: null,
  education: null,
};
const JOB = {
  id: "job-1",
  userId: USER_ID,
  title: "Engineer",
  company: "Acme",
  market: "AU",
  description: "Build reliable TypeScript APIs.",
};
const RENDER_CONTEXT = buildApplicationPublicationRenderContext({
  profile: PROFILE,
  job: JOB,
});
const COMMITTED_PUBLICATION = {
  status: "FINAL" as const,
  resume: {
    status: "FINAL" as const,
    contentHash: "resume-content-hash",
    publishedHash: "resume-content-hash",
  },
  cover: {
    status: "FINAL" as const,
    contentHash: "cover-content-hash",
    publishedHash: "cover-content-hash",
  },
};

function ownedReviewSources() {
  return {
    jobId: JOB.id,
    company: JOB.company,
    role: JOB.title,
    resumeProfile: PROFILE,
    job: JOB,
  };
}

function makeAiContent(): AiContent {
  return {
    schemaVersion: AI_CONTENT_SCHEMA_VERSION,
    generatedAt: "2026-05-09T00:00:00.000Z",
    promptMetaHash: "p1",
    cv: {
      summary: { aiText: "ai", originalText: "orig", accepted: true },
      latestExperience: { experienceIndex: 0, addedBullets: [] },
    },
    cover: {
      paragraphOne: { aiText: "", accepted: false },
      paragraphTwo: { aiText: "", accepted: false },
      paragraphThree: { aiText: "", accepted: false },
    },
  };
}

function makeRequest(body: unknown, target?: "resume" | "cover") {
  const search = target ? `?target=${target}` : "";
  return new Request(
    `http://localhost/api/applications/${APP_ID}/finalize${search}`,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    },
  );
}

const params = Promise.resolve({ id: APP_ID });

describe("POST /api/applications/[id]/finalize", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    prisma.application.findFirst.mockReset();
    renderer.renderApplicationPdf.mockReset().mockResolvedValue({
      pdf: Buffer.from("%PDF-1.7"),
      filename: "Jane Doe Engineer_CV.pdf",
    });
    renderer.renderCoverLetterPdf.mockReset().mockResolvedValue({
      pdf: Buffer.from("%PDF-1.7"),
      filename: "Jane Doe Engineer_CL.pdf",
    });
    ats.assertAtsPdf.mockReset().mockResolvedValue({
      passed: true,
      pageCount: 1,
      textLength: 400,
      keywordCoverage: 100,
      matchedKeywords: [],
      missingKeywords: [],
      errors: [],
      warnings: [],
    });
    commit.commitApplicationArtifact.mockReset().mockResolvedValue({
      kind: "committed",
      applicationId: APP_ID,
      aiContent: makeAiContent(),
      aiContentHash: "committed-hash",
      publication: COMMITTED_PUBLICATION,
      urls: { resume: "https://blob.example/new-resume.pdf" },
    });
    publicationReplay.confirmApplicationPublicationReplay
      .mockReset()
      .mockResolvedValue({ kind: "render_required" });
    renderLimiter.enforce.mockReset().mockReturnValue(null);
  });

  it("renders the PDF and hands it to the commit module with the expected hash", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    const ai = makeAiContent();
    const hash = hashAiContent(ai);
    prisma.application.findFirst.mockResolvedValueOnce({
      ...ownedReviewSources(),
      id: APP_ID,
      userId: USER_ID,
      aiContent: ai,
      aiContentHash: hash,
      resumeProfileId: "profile-linked",
      resumePdfUrl: "https://blob/old.pdf",
      coverPdfUrl: null,
    });
    commit.commitApplicationArtifact.mockResolvedValueOnce({
      kind: "committed",
      applicationId: APP_ID,
      aiContent: ai,
      aiContentHash: "committed-hash",
      publication: COMMITTED_PUBLICATION,
      urls: { resume: "https://blob/r.pdf" },
    });

    const res = await POST(makeRequest({ expectedHash: hash }), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("FINAL");
    expect(json.resumePdfUrl).toBe("https://blob/r.pdf");
    expect(json.aiContentHash).toBe("committed-hash");
    expect(renderer.renderApplicationPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: APP_ID,
        userId: USER_ID,
        resumeProfileId: "profile-linked",
        aiContent: expect.objectContaining({
          cv: expect.objectContaining({
            summary: expect.objectContaining({
              aiText: ai.cv.summary.aiText,
            }),
          }),
          cover: expect.objectContaining({
            paragraphOne: expect.objectContaining({
              aiText: ai.cover.paragraphOne.aiText,
            }),
          }),
          review: expect.any(Object),
        }),
      }),
    );
    expect(commit.commitApplicationArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        expectedHash: hash,
        status: "FINAL",
        artifacts: [
          expect.objectContaining({
            target: "resume",
          }),
        ],
      }),
    );
    expect(renderLimiter.enforce).toHaveBeenCalledWith(USER_ID, expect.any(String));
  });

  it("publishes an already-persisted batch target with its Tailoring Run fence", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    const ai = makeAiContent();
    const hash = hashAiContent(ai);
    prisma.application.findFirst.mockResolvedValueOnce({
      ...ownedReviewSources(),
      id: APP_ID,
      userId: USER_ID,
      status: "DRAFT",
      aiContent: ai,
      aiContentHash: hash,
      resumeProfileId: "profile-linked",
      resumePdfUrl: null,
      coverPdfUrl: null,
    });

    const res = await POST(
      makeRequest({
        expectedHash: hash,
        tailoringRun: { id: RUN_ID, attemptId: ATTEMPT_ID },
        batchAttemptId: ATTEMPT_ID,
      }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(commit.commitApplicationArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedHash: hash,
        tailoringPublication: {
          handle: { id: RUN_ID, attemptId: ATTEMPT_ID },
          applicationId: APP_ID,
          target: "RESUME",
          batchExecutionAttemptId: ATTEMPT_ID,
        },
      }),
    );
  });

  it("settles a Tailoring Run receipt when the PDF was already finalized manually", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    const ai = makeAiContent();
    const hash = hashAiContent(ai);
    const resumeHash = hashApplicationDocumentContent(
      ai,
      "resume",
      RENDER_CONTEXT,
    );
    prisma.application.findFirst.mockResolvedValueOnce({
      ...ownedReviewSources(),
      id: APP_ID,
      userId: USER_ID,
      status: "DRAFT",
      aiContent: ai,
      aiContentHash: hash,
      resumeProfileId: PROFILE.id,
      resumePdfUrl: "https://blob.example/current-resume.pdf",
      coverPdfUrl: null,
      resumeContentHash: resumeHash,
      resumePublishedHash: resumeHash,
      coverContentHash: null,
      coverPublishedHash: null,
    });
    publicationReplay.confirmApplicationPublicationReplay.mockResolvedValueOnce({
      kind: "replayed",
      aiContentHash: hash,
      publication: {
        status: "DRAFT",
        resume: {
          status: "FINAL",
          contentHash: resumeHash,
          publishedHash: resumeHash,
        },
        cover: { status: "MISSING", contentHash: null, publishedHash: null },
      },
      resumePdfUrl: "https://blob.example/current-resume.pdf",
      resumePdfName: null,
      coverPdfUrl: null,
    });

    const res = await POST(
      makeRequest({
        expectedHash: hash,
        tailoringRun: { id: RUN_ID, attemptId: ATTEMPT_ID },
        batchAttemptId: ATTEMPT_ID,
      }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(publicationReplay.confirmApplicationPublicationReplay).toHaveBeenCalledWith(
      expect.objectContaining({
        tailoringPublication: {
          handle: { id: RUN_ID, attemptId: ATTEMPT_ID },
          applicationId: APP_ID,
          target: "RESUME",
          batchExecutionAttemptId: ATTEMPT_ID,
        },
      }),
    );
    expect(renderer.renderApplicationPdf).not.toHaveBeenCalled();
    expect(commit.commitApplicationArtifact).not.toHaveBeenCalled();
  });

  it.each(["resume", "cover"] as const)(
    "renders %s from the same Profile and Job snapshot used for publication identity",
    async (target) => {
      (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        user: { id: USER_ID },
      });
      const ai = makeAiContent();
      const hash = hashAiContent(ai);
      prisma.application.findFirst.mockResolvedValueOnce({
        ...ownedReviewSources(),
        id: APP_ID,
        userId: USER_ID,
        status: "DRAFT",
        aiContent: ai,
        aiContentHash: hash,
        resumeProfileId: PROFILE.id,
        resumePdfUrl: null,
        coverPdfUrl: null,
      });

      const response = await POST(makeRequest({ expectedHash: hash }, target), {
        params,
      });

      expect(response.status).toBe(200);
      const render =
        target === "resume"
          ? renderer.renderApplicationPdf
          : renderer.renderCoverLetterPdf;
      expect(render).toHaveBeenCalledWith(
        expect.objectContaining({
          profileSnapshot: PROFILE,
          job: {
            id: JOB.id,
            title: JOB.title,
            company: JOB.company,
            market: JOB.market,
          },
        }),
      );
      expect(commit.commitApplicationArtifact).toHaveBeenCalledWith(
        expect.objectContaining({
          publicationRenderContext: RENDER_CONTEXT,
        }),
      );
    },
  );

  it("replays a current Resume while Cover remains Draft", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    const ai = makeAiContent();
    ai.cover.paragraphOne.aiText = "One";
    ai.cover.paragraphTwo.aiText = "Two";
    ai.cover.paragraphThree.aiText = "Three";
    const hash = hashAiContent(ai);
    const resumeHash = hashApplicationDocumentContent(
      ai,
      "resume",
      RENDER_CONTEXT,
    );
    const coverHash = hashApplicationDocumentContent(
      ai,
      "cover",
      RENDER_CONTEXT,
    );
    prisma.application.findFirst.mockResolvedValueOnce({
      ...ownedReviewSources(),
      id: APP_ID,
      userId: USER_ID,
      status: "DRAFT",
      aiContent: ai,
      aiContentHash: hash,
      resumeProfileId: "profile-linked",
      resumePdfUrl: "https://blob.example/current-resume.pdf",
      coverPdfUrl: "https://blob.example/previous-cover.pdf",
      resumeContentHash: resumeHash,
      resumePublishedHash: resumeHash,
      coverContentHash: coverHash,
      coverPublishedHash: "previous-cover-hash",
    });
    publicationReplay.confirmApplicationPublicationReplay.mockResolvedValueOnce({
      kind: "replayed",
      aiContentHash: hash,
      publication: {
        status: "DRAFT",
        resume: {
          status: "FINAL",
          contentHash: resumeHash,
          publishedHash: resumeHash,
        },
        cover: {
          status: "DRAFT",
          contentHash: coverHash,
          publishedHash: "previous-cover-hash",
        },
      },
      resumePdfUrl: "https://blob.example/current-resume.pdf",
      resumePdfName: null,
      coverPdfUrl: "https://blob.example/previous-cover.pdf",
    });

    const res = await POST(makeRequest({ expectedHash: hash }), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("DRAFT");
    expect(json.publication.resume.status).toBe("FINAL");
    expect(json.publication.cover.status).toBe("DRAFT");
    expect(renderer.renderApplicationPdf).not.toHaveBeenCalled();
    expect(commit.commitApplicationArtifact).not.toHaveBeenCalled();
    expect(
      publicationReplay.confirmApplicationPublicationReplay,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: APP_ID,
        expectedHash: hash,
        target: "resume",
      }),
    );
  });

  it("re-renders instead of replaying when the Master Resume input changed", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    const ai = makeAiContent();
    const hash = hashAiContent(ai);
    const previousRenderContext = buildApplicationPublicationRenderContext({
      profile: {
        ...PROFILE,
        basics: { fullName: "Previous Candidate Name" },
      },
      job: JOB,
    });
    const previousResumeHash = hashApplicationDocumentContent(
      ai,
      "resume",
      previousRenderContext,
    );
    prisma.application.findFirst.mockResolvedValueOnce({
      ...ownedReviewSources(),
      id: APP_ID,
      userId: USER_ID,
      status: "FINAL",
      aiContent: ai,
      aiContentHash: hash,
      resumeProfileId: PROFILE.id,
      resumePdfUrl: "https://blob.example/previous-resume.pdf",
      coverPdfUrl: null,
      resumeContentHash: previousResumeHash,
      resumePublishedHash: previousResumeHash,
      coverContentHash: null,
      coverPublishedHash: null,
    });
    commit.commitApplicationArtifact.mockResolvedValueOnce({
      kind: "committed",
      applicationId: APP_ID,
      aiContent: ai,
      aiContentHash: hash,
      publication: COMMITTED_PUBLICATION,
      urls: { resume: "https://blob.example/current-resume.pdf" },
    });

    const response = await POST(makeRequest({ expectedHash: hash }), { params });

    expect(response.status).toBe(200);
    expect(renderer.renderApplicationPdf).toHaveBeenCalledOnce();
    expect(commit.commitApplicationArtifact).toHaveBeenCalledOnce();
  });

  it("returns 409 on stale expectedHash before rendering anything", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    prisma.application.findFirst.mockResolvedValueOnce({
      ...ownedReviewSources(),
      id: APP_ID,
      userId: USER_ID,
      aiContent: makeAiContent(),
      aiContentHash: "actual",
    });

    const res = await POST(makeRequest({ expectedHash: "stale" }), { params });

    expect(res.status).toBe(409);
    expect(renderer.renderApplicationPdf).not.toHaveBeenCalled();
    expect(commit.commitApplicationArtifact).not.toHaveBeenCalled();
  });

  it("returns 409 when the commit module loses the compare-and-swap", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    const ai = makeAiContent();
    const hash = hashAiContent(ai);
    prisma.application.findFirst.mockResolvedValueOnce({
      ...ownedReviewSources(),
      id: APP_ID,
      userId: USER_ID,
      aiContent: ai,
      aiContentHash: hash,
      resumePdfUrl: "https://blob/old.pdf",
      coverPdfUrl: null,
    });
    // An autosave landed between the read and the write.
    commit.commitApplicationArtifact.mockResolvedValueOnce({ kind: "stale_write" });

    const res = await POST(makeRequest({ expectedHash: hash }), { params });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "STALE_WRITE" },
    });
  });

  it("returns 409 when Profile or Job render inputs change during PDF generation", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    const ai = makeAiContent();
    const hash = hashAiContent(ai);
    prisma.application.findFirst.mockResolvedValueOnce({
      ...ownedReviewSources(),
      id: APP_ID,
      userId: USER_ID,
      aiContent: ai,
      aiContentHash: hash,
      resumeProfileId: PROFILE.id,
      resumePdfUrl: null,
      coverPdfUrl: null,
    });
    commit.commitApplicationArtifact.mockResolvedValueOnce({
      kind: "stale_render_context",
    });

    const response = await POST(makeRequest({ expectedHash: hash }), { params });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "STALE_RENDER_CONTEXT" },
    });
  });

  it("returns a typed 503 when production artifact storage is unavailable", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    const ai = makeAiContent();
    const hash = hashAiContent(ai);
    prisma.application.findFirst.mockResolvedValueOnce({
      ...ownedReviewSources(),
      id: APP_ID,
      userId: USER_ID,
      aiContent: ai,
      aiContentHash: hash,
      resumePdfUrl: null,
      coverPdfUrl: null,
    });
    commit.commitApplicationArtifact.mockResolvedValueOnce({
      kind: "blob_not_configured",
    });

    const res = await POST(makeRequest({ expectedHash: hash }), { params });

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "ARTIFACT_STORAGE_UNAVAILABLE" },
    });
  });

  it("returns 400 when the Application has no aiContent (legacy row)", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    prisma.application.findFirst.mockResolvedValueOnce({
      id: APP_ID,
      userId: USER_ID,
      aiContent: null,
      aiContentHash: null,
    });

    const res = await POST(makeRequest({ expectedHash: null }), { params });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("NO_AI_CONTENT");
  });

  it("returns 404 when the Application belongs to another user", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    prisma.application.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ expectedHash: null }), { params });
    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(makeRequest({ expectedHash: null }), { params });
    expect(res.status).toBe(401);
  });

  it("returns the current published artifact without compiling it again", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    const ai = attachEvidenceAndReview({
      aiContent: makeAiContent(),
      resumeSnapshot: {
        profile: PROFILE,
        renderInput: mapResumeProfile(PROFILE),
      },
      jobDescription: JOB.description,
      scopeKey: USER_ID,
    });
    const hash = hashAiContent(ai);
    const resumeContentHash = hashApplicationDocumentContent(
      ai,
      "resume",
      RENDER_CONTEXT,
    );
    const resumePdfUrl = "https://blob.example/current-resume.pdf";
    prisma.application.findFirst.mockResolvedValueOnce({
      ...ownedReviewSources(),
      id: APP_ID,
      userId: USER_ID,
      status: "FINAL",
      aiContent: ai,
      aiContentHash: hash,
      resumePdfUrl,
      resumePdfName: "resume.pdf",
      coverPdfUrl: null,
      resumeContentHash,
      resumePublishedHash: resumeContentHash,
      coverContentHash: null,
      coverPublishedHash: null,
    });
    publicationReplay.confirmApplicationPublicationReplay.mockResolvedValueOnce({
      kind: "replayed",
      aiContentHash: hash,
      publication: {
        status: "FINAL",
        resume: {
          status: "FINAL",
          contentHash: resumeContentHash,
          publishedHash: resumeContentHash,
        },
        cover: {
          status: "MISSING",
          contentHash: null,
          publishedHash: null,
        },
      },
      resumePdfUrl,
      resumePdfName: "resume.pdf",
      coverPdfUrl: null,
    });

    const response = await POST(makeRequest({ expectedHash: hash }), { params });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.resumePdfUrl).toBe(resumePdfUrl);
    expect(renderer.renderApplicationPdf).not.toHaveBeenCalled();
    expect(commit.commitApplicationArtifact).not.toHaveBeenCalled();
    expect(renderLimiter.enforce).not.toHaveBeenCalled();
  });

  it("returns a retryable conflict when the locked Final replay sees changed sources", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    const ai = makeAiContent();
    const hash = hashAiContent(ai);
    const resumeHash = hashApplicationDocumentContent(
      ai,
      "resume",
      RENDER_CONTEXT,
    );
    prisma.application.findFirst.mockResolvedValueOnce({
      ...ownedReviewSources(),
      id: APP_ID,
      userId: USER_ID,
      status: "FINAL",
      aiContent: ai,
      aiContentHash: hash,
      resumeProfileId: PROFILE.id,
      resumePdfUrl: "https://blob.example/current-resume.pdf",
      coverPdfUrl: null,
      resumeContentHash: resumeHash,
      resumePublishedHash: resumeHash,
      coverContentHash: null,
      coverPublishedHash: null,
    });
    publicationReplay.confirmApplicationPublicationReplay.mockResolvedValueOnce({
      kind: "stale_render_context",
    });

    const response = await POST(makeRequest({ expectedHash: hash }), { params });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "STALE_RENDER_CONTEXT" },
    });
    expect(renderer.renderApplicationPdf).not.toHaveBeenCalled();
    expect(commit.commitApplicationArtifact).not.toHaveBeenCalled();
  });

  it("returns the user-level render limit before compiling", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    const ai = makeAiContent();
    const hash = hashAiContent(ai);
    prisma.application.findFirst.mockResolvedValueOnce({
      ...ownedReviewSources(),
      id: APP_ID,
      userId: USER_ID,
      status: "DRAFT",
      aiContent: ai,
      aiContentHash: hash,
      resumePdfUrl: null,
      resumePdfName: null,
      coverPdfUrl: null,
    });
    renderLimiter.enforce.mockReturnValueOnce(
      new Response(JSON.stringify({ error: { code: "RATE_LIMITED" } }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await POST(makeRequest({ expectedHash: hash }), { params });

    expect(response.status).toBe(429);
    expect(renderer.renderApplicationPdf).not.toHaveBeenCalled();
    expect(commit.commitApplicationArtifact).not.toHaveBeenCalled();
  });

  it("blocks unsupported claims in a legacy row with no prior review", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    const legacy = makeAiContent();
    legacy.cover.paragraphOne = {
      aiText: "I increased revenue by 999% without supporting evidence.",
      accepted: true,
    };
    const hash = hashAiContent(legacy);
    prisma.application.findFirst.mockResolvedValueOnce({
      ...ownedReviewSources(),
      id: APP_ID,
      userId: USER_ID,
      status: "DRAFT",
      aiContent: legacy,
      aiContentHash: hash,
      resumePdfUrl: null,
      resumePdfName: null,
      coverPdfUrl: null,
      atsValidation: null,
    });

    const response = await POST(makeRequest({ expectedHash: hash }), { params });
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.error.code).toBe("APPLICATION_REVIEW_BLOCKED");
    expect(json.error.details.issues.join(" ")).toContain("999%");
    expect(renderer.renderApplicationPdf).not.toHaveBeenCalled();
    expect(commit.commitApplicationArtifact).not.toHaveBeenCalled();
  });

  it("rebuilds stored evidence from server sources and blocks a forged pass verdict", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    const profile = {
      userId: USER_ID,
      summary: "Built reliable TypeScript APIs.",
      basics: null,
      links: null,
      skills: null,
      experiences: null,
      projects: null,
      education: null,
    };
    const forged = attachEvidenceAndReview({
      aiContent: makeAiContent(),
      resumeSnapshot: profile,
      jobDescription: "Build reliable TypeScript APIs.",
      scopeKey: USER_ID,
    });
    forged.cv.summary.userEdit = "Improved revenue by 999%.";
    forged.evidence = [
      {
        id: `ev_${"f".repeat(32)}`,
        kind: "candidate",
        path: "resume.summary",
        contentHash: "f".repeat(64),
        excerpt: "improved revenue by 999%",
      },
    ];
    forged.review = {
      verdict: "pass",
      reviewedAt: "2026-07-20T12:00:00.000Z",
      coveragePercent: 100,
      requirements: [],
      issues: [],
    };
    const hash = hashAiContent(forged);
    prisma.application.findFirst.mockResolvedValueOnce({
      id: APP_ID,
      userId: USER_ID,
      status: "DRAFT",
      aiContent: forged,
      aiContentHash: hash,
      resumePdfUrl: null,
      resumePdfName: null,
      coverPdfUrl: null,
      atsValidation: null,
      jobId: "job-1",
      company: "Acme",
      role: "Engineer",
      resumeProfile: profile,
      job: {
        id: "job-1",
        userId: USER_ID,
        title: "Engineer",
        company: "Acme",
        market: "AU",
        description: "Build reliable TypeScript APIs.",
      },
    });

    const response = await POST(makeRequest({ expectedHash: hash }), { params });
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.error.code).toBe("APPLICATION_REVIEW_BLOCKED");
    expect(json.error.details.issues.join(" ")).toContain("999%");
    expect(renderer.renderApplicationPdf).not.toHaveBeenCalled();
    expect(commit.commitApplicationArtifact).not.toHaveBeenCalled();
  });
});
