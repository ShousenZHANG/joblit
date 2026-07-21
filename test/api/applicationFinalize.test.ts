import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  application: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  transaction: vi.fn(),
  executeRaw: vi.fn(),
}));
const renderer = vi.hoisted(() => ({
  deleteApplicationArtifact: vi.fn(),
  renderFinalApplication: vi.fn(),
  renderFinalCoverLetter: vi.fn(),
}));
const renderLimiter = vi.hoisted(() => ({
  enforce: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    application: prisma.application,
    $transaction: prisma.transaction,
  },
}));
vi.mock("@/lib/server/applications/finalizeApplication", () => renderer);
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

const APP_ID = "22222222-2222-4222-9222-222222222222";
const USER_ID = "user-1";

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

function makeRequest(body: unknown) {
  return new Request(`http://localhost/api/applications/${APP_ID}/finalize`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const params = Promise.resolve({ id: APP_ID });

describe("POST /api/applications/[id]/finalize", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    prisma.application.findFirst.mockReset();
    prisma.application.updateMany.mockReset();
    prisma.application.updateMany.mockResolvedValue({ count: 1 });
    prisma.executeRaw.mockReset().mockResolvedValue(1);
    prisma.transaction.mockReset().mockImplementation(
      async (
        action: (tx: {
          application: typeof prisma.application;
          $executeRaw: typeof prisma.executeRaw;
        }) => Promise<unknown>,
      ) =>
        action({
          application: prisma.application,
          $executeRaw: prisma.executeRaw,
        }),
    );
    renderer.renderFinalApplication.mockReset();
    renderer.renderFinalCoverLetter.mockReset();
    renderer.deleteApplicationArtifact.mockReset();
    renderer.deleteApplicationArtifact.mockResolvedValue(undefined);
    renderLimiter.enforce.mockReset();
    renderLimiter.enforce.mockReturnValue(null);
  });

  it("renders PDF, flips status to FINAL, returns the new resumePdfUrl", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    const ai = makeAiContent();
    const hash = hashAiContent(ai);
    prisma.application.findFirst.mockResolvedValueOnce({
      id: APP_ID,
      userId: USER_ID,
      aiContent: ai,
      aiContentHash: hash,
      resumeProfileId: "profile-linked",
      resumePdfUrl: "https://blob/old.pdf",
      coverPdfUrl: null,
    });
    renderer.renderFinalApplication.mockResolvedValueOnce({
      resumePdfUrl: "https://blob/r.pdf",
      resumePdfName: "r.pdf",
    });
    const res = await POST(makeRequest({ expectedHash: hash }), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("FINAL");
    expect(json.resumePdfUrl).toBe("https://blob/r.pdf");
    expect(renderer.renderFinalApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: APP_ID,
        userId: USER_ID,
        resumeProfileId: "profile-linked",
        aiContent: ai,
        artifactVersion: expect.stringMatching(
          new RegExp(`^${hash}-[0-9a-f-]{36}$`),
        ),
      }),
    );
    expect(prisma.application.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: APP_ID,
          userId: USER_ID,
          aiContentHash: hash,
          resumePdfUrl: "https://blob/old.pdf",
        },
        data: expect.objectContaining({
          status: "FINAL",
          resumePdfUrl: "https://blob/r.pdf",
        }),
      }),
    );
    expect(renderer.deleteApplicationArtifact).toHaveBeenCalledWith(
      "https://blob/old.pdf",
    );
    expect(renderLimiter.enforce).toHaveBeenCalledWith(
      USER_ID,
      expect.any(String),
    );
  });

  it("returns 409 on stale expectedHash", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    prisma.application.findFirst.mockResolvedValueOnce({
      id: APP_ID,
      userId: USER_ID,
      aiContent: makeAiContent(),
      aiContentHash: "actual",
    });

    const res = await POST(makeRequest({ expectedHash: "stale" }), { params });

    expect(res.status).toBe(409);
    expect(renderer.renderFinalApplication).not.toHaveBeenCalled();
    expect(prisma.application.updateMany).not.toHaveBeenCalled();
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

  it("deletes a distinct uncommitted Blob when autosave wins during render", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    const ai = makeAiContent();
    const hash = hashAiContent(ai);
    prisma.application.findFirst.mockResolvedValueOnce({
      id: APP_ID,
      userId: USER_ID,
      aiContent: ai,
      aiContentHash: hash,
      resumePdfUrl: "https://blob/old.pdf",
      coverPdfUrl: null,
    });
    renderer.renderFinalApplication.mockResolvedValueOnce({
      resumePdfUrl: "https://blob/uncommitted.pdf",
      resumePdfName: "resume.pdf",
    });
    prisma.application.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await POST(makeRequest({ expectedHash: hash }), { params });

    expect(response.status).toBe(409);
    expect(renderer.deleteApplicationArtifact).toHaveBeenCalledWith(
      "https://blob/uncommitted.pdf",
    );
    expect(renderer.deleteApplicationArtifact).not.toHaveBeenCalledWith(
      "https://blob/old.pdf",
    );
  });

  it("does not delete a still-referenced Blob when a same-URL CAS loses", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    const ai = makeAiContent();
    const hash = hashAiContent(ai);
    prisma.application.findFirst.mockResolvedValueOnce({
      id: APP_ID,
      userId: USER_ID,
      aiContent: ai,
      aiContentHash: hash,
      resumePdfUrl: "https://blob/shared.pdf",
      coverPdfUrl: null,
    });
    renderer.renderFinalApplication.mockResolvedValueOnce({
      resumePdfUrl: "https://blob/shared.pdf",
      resumePdfName: "resume.pdf",
    });
    prisma.application.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await POST(makeRequest({ expectedHash: hash }), { params });

    expect(response.status).toBe(409);
    expect(renderer.deleteApplicationArtifact).not.toHaveBeenCalled();
  });

  it("deletes the uncommitted Blob when the database commit throws", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    const ai = makeAiContent();
    const hash = hashAiContent(ai);
    prisma.application.findFirst.mockResolvedValueOnce({
      id: APP_ID,
      userId: USER_ID,
      aiContent: ai,
      aiContentHash: hash,
      resumePdfUrl: "https://blob/old.pdf",
      coverPdfUrl: null,
    });
    renderer.renderFinalApplication.mockResolvedValueOnce({
      resumePdfUrl: "https://blob/uncommitted.pdf",
      resumePdfName: "resume.pdf",
    });
    prisma.application.updateMany.mockRejectedValueOnce(new Error("db unavailable"));

    await expect(
      POST(makeRequest({ expectedHash: hash }), { params }),
    ).rejects.toThrow("db unavailable");
    expect(renderer.deleteApplicationArtifact).toHaveBeenCalledWith(
      "https://blob/uncommitted.pdf",
    );
    expect(renderer.deleteApplicationArtifact).not.toHaveBeenCalledWith(
      "https://blob/old.pdf",
    );
  });

  it("returns an already-versioned artifact without compiling it again", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    const ai = makeAiContent();
    const hash = hashAiContent(ai);
    const resumePdfUrl =
      `https://blob.vercel-storage.com/applications/${USER_ID}/job-1/` +
      `resume.${hash}-123e4567-e89b-42d3-a456-426614174000.pdf`;
    prisma.application.findFirst.mockResolvedValueOnce({
      id: APP_ID,
      userId: USER_ID,
      status: "FINAL",
      aiContent: ai,
      aiContentHash: hash,
      resumePdfUrl,
      resumePdfName: "resume.pdf",
      coverPdfUrl: null,
    });

    const response = await POST(makeRequest({ expectedHash: hash }), { params });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.resumePdfUrl).toBe(resumePdfUrl);
    expect(renderer.renderFinalApplication).not.toHaveBeenCalled();
    expect(prisma.application.updateMany).not.toHaveBeenCalled();
    expect(renderLimiter.enforce).not.toHaveBeenCalled();
  });

  it("returns the user-level render limit before compiling", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    const ai = makeAiContent();
    const hash = hashAiContent(ai);
    prisma.application.findFirst.mockResolvedValueOnce({
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
    expect(renderer.renderFinalApplication).not.toHaveBeenCalled();
    expect(prisma.application.updateMany).not.toHaveBeenCalled();
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
    expect(renderer.renderFinalApplication).not.toHaveBeenCalled();
    expect(prisma.application.updateMany).not.toHaveBeenCalled();
  });
});
