import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  application: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  evidenceSnapshot: { createMany: vi.fn() },
  claimEvidence: { createMany: vi.fn() },
  tailoringRun: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  transaction: vi.fn(),
  executeRaw: vi.fn(),
}));

const renderContextFence = vi.hoisted(() => ({
  matches: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    application: prisma.application,
    $transaction: prisma.transaction,
  },
}));
vi.mock("@/lib/server/applications/applicationRenderContextFence", () => ({
  applicationRenderContextMatchesCurrentSources: renderContextFence.matches,
  applicationPublicationTargets: vi.fn(() => ["resume", "cover"]),
}));
vi.mock("@/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/applications/[id]/discard/route";
import {
  AI_CONTENT_SCHEMA_VERSION,
  hashAiContent,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";
import {
  buildApplicationPublicationRenderContext,
  hashApplicationDocumentContent,
} from "@/lib/server/applications/applicationPublication";

const APP_ID = "33333333-3333-4333-9333-333333333333";
const USER_ID = "user-1";
const PROFILE = {
  id: "profile-1",
  userId: USER_ID,
  summary: "Base summary",
  basics: null,
  links: null,
  skills: null,
  experiences: null,
  projects: null,
  education: null,
};
const JOB = {
  userId: USER_ID,
  title: "Engineer",
  company: "Acme",
  description: "Build reliable TypeScript APIs.",
  market: "AU",
};
const RENDER_CONTEXT = buildApplicationPublicationRenderContext({
  profile: PROFILE,
  job: JOB,
});

function makeEditedAiContent(): AiContent {
  return {
    schemaVersion: AI_CONTENT_SCHEMA_VERSION,
    generatedAt: "2026-05-09T00:00:00.000Z",
    promptMetaHash: "p1",
    cv: {
      summary: {
        aiText: "ai",
        originalText: "orig",
        userEdit: "user override",
        accepted: false,
      },
      latestExperience: {
        experienceIndex: 0,
        addedBullets: [
          {
            text: "passed bullet",
            userEdit: "edited user text",
            accepted: false,
            qualityGate: { passed: true },
          },
          {
            text: "rejected bullet",
            accepted: true,
            qualityGate: {
              passed: false,
              reason: "ungrounded: no JD evidence",
            },
          },
        ],
      },
    },
    cover: {
      paragraphOne: { aiText: "p1", userEdit: "edited", accepted: false },
      paragraphTwo: { aiText: "p2", accepted: true },
      paragraphThree: { aiText: "p3", accepted: true },
    },
  };
}

const params = Promise.resolve({ id: APP_ID });
const request = (expectedHash: string | null) =>
  new Request(`http://localhost/api/applications/${APP_ID}/discard`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedHash }),
  });

describe("POST /api/applications/[id]/discard", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    prisma.application.findFirst.mockReset();
    prisma.application.updateMany.mockReset().mockResolvedValue({ count: 1 });
    prisma.evidenceSnapshot.createMany
      .mockReset()
      .mockResolvedValue({ count: 1 });
    prisma.claimEvidence.createMany.mockReset().mockResolvedValue({ count: 1 });
    prisma.tailoringRun.findMany.mockReset().mockResolvedValue([]);
    prisma.tailoringRun.findFirst.mockReset().mockResolvedValue(null);
    prisma.tailoringRun.updateMany.mockReset().mockResolvedValue({ count: 0 });
    prisma.executeRaw.mockReset().mockResolvedValue(1);
    renderContextFence.matches.mockReset().mockResolvedValue(true);
    prisma.transaction
      .mockReset()
      .mockImplementation(
        async (
          action: (tx: {
            application: typeof prisma.application;
            evidenceSnapshot: typeof prisma.evidenceSnapshot;
            claimEvidence: typeof prisma.claimEvidence;
            tailoringRun: typeof prisma.tailoringRun;
            $executeRaw: typeof prisma.executeRaw;
          }) => Promise<unknown>,
        ) =>
          action({
            application: prisma.application,
            evidenceSnapshot: prisma.evidenceSnapshot,
            claimEvidence: prisma.claimEvidence,
            tailoringRun: prisma.tailoringRun,
            $executeRaw: prisma.executeRaw,
          }),
      );
  });

  it("clears userEdits and resets bullet accepted to qualityGate.passed", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: USER_ID },
      },
    );
    const edited = makeEditedAiContent();
    const expectedHash = hashAiContent(edited);
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
    prisma.application.findFirst.mockResolvedValue({
      id: APP_ID,
      userId: USER_ID,
      jobId: "job-1",
      aiContent: edited,
      aiContentHash: expectedHash,
      resumeProfile: profile,
      job: {
        ...JOB,
        description: "Build reliable TypeScript APIs.",
      },
    });

    const res = await POST(request(expectedHash), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("DRAFT");

    const updateCall = prisma.application.updateMany.mock.calls[0]?.[0];
    const persisted = updateCall.data.aiContent as AiContent;

    // Summary: userEdit cleared, accepted back to true
    expect(persisted.cv.summary.userEdit).toBeUndefined();
    expect(persisted.cv.summary.accepted).toBe(true);

    // Bullet 1 (passed gate): userEdit cleared, accepted=true
    expect(
      persisted.cv.latestExperience.addedBullets[0]?.userEdit,
    ).toBeUndefined();
    expect(persisted.cv.latestExperience.addedBullets[0]?.accepted).toBe(true);

    // Bullet 2 (failed gate): accepted=false (matches gate verdict)
    expect(persisted.cv.latestExperience.addedBullets[1]?.accepted).toBe(false);

    // Cover paragraphs: userEdit cleared, accepted=true
    expect(persisted.cover.paragraphOne.userEdit).toBeUndefined();
    expect(persisted.cover.paragraphOne.accepted).toBe(true);

    expect(updateCall.data.status).toBe("DRAFT");
    expect(persisted.review).toBeDefined();
    expect(prisma.evidenceSnapshot.createMany).toHaveBeenCalled();
    expect(prisma.tailoringRun.findFirst).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        jobId: "job-1",
        status: { in: ["ISSUED", "RUNNING"] },
      },
      select: { id: true },
    });
    expect(prisma.executeRaw).toHaveBeenCalledTimes(2);
    expect(
      prisma.tailoringRun.findFirst.mock.invocationCallOrder[0],
    ).toBeLessThan(prisma.executeRaw.mock.invocationCallOrder[1]!);
  });

  it.each(["ISSUED", "RUNNING"] as const)(
    "returns ATTEMPT_ACTIVE without updating while a %s run owns the Job",
    async (status) => {
      (
        getServerSession as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        user: { id: USER_ID },
      });
      const edited = makeEditedAiContent();
      const expectedHash = hashAiContent(edited);
      prisma.application.findFirst.mockResolvedValue({
        id: APP_ID,
        userId: USER_ID,
        jobId: "job-1",
        aiContent: edited,
        aiContentHash: expectedHash,
        status: "DRAFT",
        resumePdfUrl: null,
        coverPdfUrl: null,
        resumeContentHash: null,
        coverContentHash: null,
        resumePublishedHash: null,
        coverPublishedHash: null,
        resumeProfile: PROFILE,
        job: JOB,
      });
      prisma.tailoringRun.findFirst.mockResolvedValueOnce({
        id: `run-${status.toLowerCase()}`,
      });

      const response = await POST(request(expectedHash), { params });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: "ATTEMPT_ACTIVE",
          message: "Another generation run already owns this Job",
        },
      });
      expect(prisma.application.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.application.updateMany).not.toHaveBeenCalled();
      expect(prisma.executeRaw).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps a published resume FINAL when discarding only cover edits", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: USER_ID },
      },
    );
    const edited = makeEditedAiContent();
    edited.cv.summary = {
      aiText: "ai",
      originalText: "orig",
      accepted: true,
    };
    edited.cv.latestExperience.addedBullets = [];
    edited.cover.paragraphOne = {
      aiText: "p1",
      userEdit: "cover-only edit",
      accepted: true,
    };
    const expectedHash = hashAiContent(edited);
    const resumeHash = hashApplicationDocumentContent(
      edited,
      "resume",
      RENDER_CONTEXT,
    );
    prisma.application.findFirst.mockResolvedValue({
      id: APP_ID,
      userId: USER_ID,
      jobId: "job-1",
      aiContent: edited,
      aiContentHash: expectedHash,
      status: "DRAFT",
      resumePdfUrl: "https://blob.example/applications/resume.pdf",
      coverPdfUrl: null,
      resumeContentHash: resumeHash,
      coverContentHash: hashApplicationDocumentContent(
        edited,
        "cover",
        RENDER_CONTEXT,
      ),
      resumePublishedHash: resumeHash,
      coverPublishedHash: null,
      resumeProfile: PROFILE,
      job: JOB,
    });

    const response = await POST(request(expectedHash), { params });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.publication).toMatchObject({
      status: "DRAFT",
      resume: {
        status: "FINAL",
        contentHash: resumeHash,
        publishedHash: resumeHash,
      },
      cover: { status: "DRAFT", publishedHash: null },
    });
    expect(prisma.application.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "DRAFT",
          resumeContentHash: resumeHash,
          resumePublishedHash: resumeHash,
          coverContentHash: json.publication.cover.contentHash,
          coverPublishedHash: null,
        }),
      }),
    );
  });

  it("rejects discard when its locked Profile or Job context is stale", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: USER_ID },
      },
    );
    const edited = makeEditedAiContent();
    const expectedHash = hashAiContent(edited);
    prisma.application.findFirst.mockResolvedValue({
      id: APP_ID,
      userId: USER_ID,
      jobId: "job-1",
      aiContent: edited,
      aiContentHash: expectedHash,
      status: "DRAFT",
      resumePdfUrl: null,
      coverPdfUrl: null,
      resumeContentHash: null,
      coverContentHash: null,
      resumePublishedHash: null,
      coverPublishedHash: null,
      resumeProfile: PROFILE,
      job: JOB,
    });
    renderContextFence.matches.mockResolvedValueOnce(false);

    const response = await POST(request(expectedHash), { params });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "STALE_RENDER_CONTEXT" },
    });
    expect(renderContextFence.matches).toHaveBeenCalledOnce();
    expect(prisma.application.updateMany).not.toHaveBeenCalled();
  });

  it("rejects discard when the Application rebinds to another Profile with the same AI hash", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: USER_ID },
      },
    );
    const edited = makeEditedAiContent();
    const expectedHash = hashAiContent(edited);
    prisma.application.findFirst
      .mockResolvedValueOnce({
        id: APP_ID,
        userId: USER_ID,
        jobId: "job-1",
        resumeProfileId: PROFILE.id,
        aiContent: edited,
        aiContentHash: expectedHash,
        status: "DRAFT",
        resumePdfUrl: null,
        coverPdfUrl: null,
        resumeContentHash: null,
        coverContentHash: null,
        resumePublishedHash: null,
        coverPublishedHash: null,
        resumeProfile: PROFILE,
        job: JOB,
      })
      .mockResolvedValueOnce({
        jobId: "job-1",
        resumeProfileId: "profile-2",
        aiContentHash: expectedHash,
        status: "DRAFT",
        resumePdfUrl: null,
        coverPdfUrl: null,
        resumeContentHash: null,
        coverContentHash: null,
        resumePublishedHash: null,
        coverPublishedHash: null,
      });

    const response = await POST(request(expectedHash), { params });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "STALE_RENDER_CONTEXT" },
    });
    expect(renderContextFence.matches).not.toHaveBeenCalled();
    expect(prisma.application.updateMany).not.toHaveBeenCalled();
  });

  it("returns 400 when there is no aiContent to discard", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: USER_ID },
      },
    );
    prisma.application.findFirst.mockResolvedValueOnce({
      id: APP_ID,
      userId: USER_ID,
      jobId: "job-1",
      aiContent: null,
      aiContentHash: null,
    });

    const res = await POST(request(null), { params });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the Application is not found", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: USER_ID },
      },
    );
    prisma.application.findFirst.mockResolvedValueOnce(null);

    const res = await POST(request(null), { params });
    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    );
    const res = await POST(request(null), { params });
    expect(res.status).toBe(401);
  });

  it("returns 409 when another tab writes after the discard read", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: USER_ID },
      },
    );
    const edited = makeEditedAiContent();
    const expectedHash = hashAiContent(edited);
    prisma.application.findFirst.mockResolvedValue({
      id: APP_ID,
      userId: USER_ID,
      jobId: "job-1",
      aiContent: edited,
      aiContentHash: expectedHash,
    });
    prisma.application.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await POST(request(expectedHash), { params });

    expect(response.status).toBe(409);
    expect(prisma.executeRaw).toHaveBeenCalled();
  });
});
