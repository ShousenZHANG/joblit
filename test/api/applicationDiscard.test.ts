import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  application: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  evidenceSnapshot: { createMany: vi.fn() },
  claimEvidence: { createMany: vi.fn() },
  transaction: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    application: prisma.application,
    $transaction: prisma.transaction,
  },
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

const APP_ID = "33333333-3333-4333-9333-333333333333";
const USER_ID = "user-1";

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
            qualityGate: { passed: false, reason: "ungrounded: no JD evidence" },
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
    prisma.evidenceSnapshot.createMany.mockReset().mockResolvedValue({ count: 1 });
    prisma.claimEvidence.createMany.mockReset().mockResolvedValue({ count: 1 });
    prisma.executeRaw.mockReset().mockResolvedValue(1);
    prisma.transaction.mockReset().mockImplementation(
      async (
        action: (tx: {
          application: typeof prisma.application;
          evidenceSnapshot: typeof prisma.evidenceSnapshot;
          claimEvidence: typeof prisma.claimEvidence;
          $executeRaw: typeof prisma.executeRaw;
        }) => Promise<unknown>,
      ) =>
        action({
          application: prisma.application,
          evidenceSnapshot: prisma.evidenceSnapshot,
          claimEvidence: prisma.claimEvidence,
          $executeRaw: prisma.executeRaw,
        }),
    );
  });

  it("clears userEdits and resets bullet accepted to qualityGate.passed", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
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
    prisma.application.findFirst.mockResolvedValueOnce({
      id: APP_ID,
      userId: USER_ID,
      jobId: "job-1",
      aiContent: edited,
      aiContentHash: expectedHash,
      resumeProfile: profile,
      job: {
        userId: USER_ID,
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
    expect(persisted.cv.latestExperience.addedBullets[0]?.userEdit).toBeUndefined();
    expect(persisted.cv.latestExperience.addedBullets[0]?.accepted).toBe(true);

    // Bullet 2 (failed gate): accepted=false (matches gate verdict)
    expect(persisted.cv.latestExperience.addedBullets[1]?.accepted).toBe(false);

    // Cover paragraphs: userEdit cleared, accepted=true
    expect(persisted.cover.paragraphOne.userEdit).toBeUndefined();
    expect(persisted.cover.paragraphOne.accepted).toBe(true);

    expect(updateCall.data.status).toBe("DRAFT");
    expect(persisted.review).toBeDefined();
    expect(prisma.evidenceSnapshot.createMany).toHaveBeenCalled();
  });

  it("returns 400 when there is no aiContent to discard", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
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
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    prisma.application.findFirst.mockResolvedValueOnce(null);

    const res = await POST(request(null), { params });
    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(request(null), { params });
    expect(res.status).toBe(401);
  });

  it("returns 409 when another tab writes after the discard read", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    const edited = makeEditedAiContent();
    const expectedHash = hashAiContent(edited);
    prisma.application.findFirst.mockResolvedValueOnce({
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
