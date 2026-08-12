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
import { PATCH } from "@/app/api/applications/[id]/draft/route";
import {
  AI_CONTENT_SCHEMA_VERSION,
  hashAiContent,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";
import { attachEvidenceAndReview } from "@/lib/server/ai/evidenceLedger";
import {
  buildApplicationPublicationRenderContext,
  hashApplicationDocumentContent,
} from "@/lib/server/applications/applicationPublication";

const APP_ID = "11111111-1111-4111-9111-111111111111";
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

function makeAiContent(overrides: Partial<AiContent> = {}): AiContent {
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
    ...overrides,
  };
}

function makeRequest(body: unknown) {
  return new Request(`http://localhost/api/applications/${APP_ID}/draft`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const params = Promise.resolve({ id: APP_ID });

function storedApplication(aiContent: AiContent, aiContentHash: string | null) {
  return {
    id: APP_ID,
    userId: USER_ID,
    jobId: "job-1",
    aiContent,
    aiContentHash,
    status: "DRAFT",
    resumePdfUrl: null,
    coverPdfUrl: null,
    resumeContentHash: null,
    coverContentHash: null,
    resumePublishedHash: null,
    coverPublishedHash: null,
    resumeProfile: null,
    job: null,
  };
}

describe("PATCH /api/applications/[id]/draft", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    prisma.application.findFirst.mockReset();
    prisma.application.updateMany.mockReset();
    prisma.application.updateMany.mockResolvedValue({ count: 1 });
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

  it("writes aiContent + DRAFT status and returns the new hash", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: USER_ID },
      },
    );
    const incoming = makeAiContent();
    prisma.application.findFirst.mockResolvedValue(
      storedApplication(incoming, null),
    );
    const res = await PATCH(
      makeRequest({ aiContent: incoming, expectedHash: null }),
      { params },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("DRAFT");
    expect(json.aiContentHash).toBe(hashAiContent(incoming));
    expect(prisma.application.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: APP_ID,
          userId: USER_ID,
          aiContentHash: null,
        },
        data: expect.objectContaining({
          status: "DRAFT",
          aiContent: incoming,
          aiContentHash: hashAiContent(incoming),
        }),
      }),
    );
    // One advisory lock now: JOBA. TJOB went with the TailoringRun table.
    expect(prisma.executeRaw).toHaveBeenCalledTimes(1);
  });

  it("rejects a save when its locked Profile or Job context is stale", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: USER_ID },
      },
    );
    const incoming = makeAiContent();
    const expectedHash = hashAiContent(incoming);
    prisma.application.findFirst.mockResolvedValue({
      ...storedApplication(incoming, expectedHash),
      resumeProfile: PROFILE,
      job: JOB,
    });
    renderContextFence.matches.mockResolvedValueOnce(false);

    const response = await PATCH(
      makeRequest({ aiContent: incoming, expectedHash }),
      { params },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "STALE_RENDER_CONTEXT" },
    });
    expect(renderContextFence.matches).toHaveBeenCalledOnce();
    expect(prisma.application.updateMany).not.toHaveBeenCalled();
  });

  it("returns 409 when expectedHash does not match the current row", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: USER_ID },
      },
    );
    prisma.application.findFirst.mockResolvedValueOnce({
      id: APP_ID,
      userId: USER_ID,
      jobId: "job-1",
      aiContentHash: "actual-hash",
    });

    const res = await PATCH(
      makeRequest({ aiContent: makeAiContent(), expectedHash: "stale-hash" }),
      { params },
    );

    expect(res.status).toBe(409);
    expect(prisma.application.updateMany).not.toHaveBeenCalled();
  });

  it("returns 404 when the Application belongs to a different user", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: USER_ID },
      },
    );
    prisma.application.findFirst.mockResolvedValueOnce(null);

    const res = await PATCH(
      makeRequest({ aiContent: makeAiContent(), expectedHash: null }),
      { params },
    );

    expect(res.status).toBe(404);
  });

  it("rejects malformed aiContent payloads with 400", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: USER_ID },
      },
    );

    const res = await PATCH(
      makeRequest({ aiContent: { wrong: true }, expectedHash: null }),
      { params },
    );

    expect(res.status).toBe(400);
    expect(prisma.application.findFirst).not.toHaveBeenCalled();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    );

    const res = await PATCH(
      makeRequest({ aiContent: makeAiContent(), expectedHash: null }),
      { params },
    );

    expect(res.status).toBe(401);
  });

  it("returns 409 when another tab writes after the initial hash check", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: USER_ID },
      },
    );
    prisma.application.findFirst.mockResolvedValue(
      storedApplication(makeAiContent(), "expected"),
    );
    prisma.application.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(
      makeRequest({
        aiContent: makeAiContent(),
        expectedHash: "expected",
      }),
      { params },
    );

    expect(response.status).toBe(409);
    expect(prisma.application.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: APP_ID,
          userId: USER_ID,
          aiContentHash: "expected",
        },
      }),
    );
  });

  it("ignores forged model output and evidence, then rebuilds review from server sources", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: USER_ID },
      },
    );
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
    const canonical = attachEvidenceAndReview({
      aiContent: makeAiContent(),
      resumeSnapshot: profile,
      jobDescription: "Build reliable TypeScript APIs.",
      scopeKey: USER_ID,
    });
    const expectedHash = hashAiContent(canonical);
    const submitted = structuredClone(canonical);
    submitted.cv.summary.aiText = "Improved revenue by 999%.";
    submitted.cv.summary.userEdit = "Improved revenue by 999%.";
    submitted.evidence = [
      {
        id: `ev_${"f".repeat(32)}`,
        kind: "candidate",
        path: "resume.summary",
        contentHash: "f".repeat(64),
        excerpt: "improved revenue by 999%",
      },
    ];
    submitted.review = {
      verdict: "pass",
      reviewedAt: "2026-07-20T12:00:00.000Z",
      coveragePercent: 100,
      requirements: [],
      issues: [],
    };
    prisma.application.findFirst.mockResolvedValue({
      ...storedApplication(canonical, expectedHash),
      resumeProfile: profile,
      job: {
        ...JOB,
        description: "Build reliable TypeScript APIs.",
      },
    });

    const response = await PATCH(
      makeRequest({ aiContent: submitted, expectedHash }),
      { params },
    );

    expect(response.status).toBe(200);
    const update = prisma.application.updateMany.mock.calls[0]?.[0];
    const persisted = update.data.aiContent as AiContent;
    expect(persisted.cv.summary.aiText).toBe("ai");
    expect(persisted.cv.summary.userEdit).toBe("Improved revenue by 999%.");
    expect(persisted.evidence?.map((item) => item.id)).toEqual(
      canonical.evidence?.map((item) => item.id),
    );
    expect(persisted.evidence?.[0]?.id).not.toBe(`ev_${"f".repeat(32)}`);
    expect(persisted.review?.verdict).toBe("blocked");
    expect(persisted.review?.issues.join(" ")).toContain("999%");
    expect(prisma.evidenceSnapshot.createMany).toHaveBeenCalled();
  });

  it("fails closed when canonical job evidence exists but the Job is gone", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: USER_ID },
      },
    );
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
    const canonical = attachEvidenceAndReview({
      aiContent: makeAiContent(),
      resumeSnapshot: profile,
      jobDescription: "Build reliable TypeScript APIs.",
      scopeKey: USER_ID,
    });
    const expectedHash = hashAiContent(canonical);
    prisma.application.findFirst.mockResolvedValue({
      ...storedApplication(canonical, expectedHash),
      resumeProfile: profile,
      job: null,
    });

    const response = await PATCH(
      makeRequest({ aiContent: canonical, expectedHash }),
      { params },
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error.code).toBe("CANONICAL_EVIDENCE_UNAVAILABLE");
    expect(prisma.application.updateMany).not.toHaveBeenCalled();
  });
});
