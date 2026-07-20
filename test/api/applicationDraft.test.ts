import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  application: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
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
import { PATCH } from "@/app/api/applications/[id]/draft/route";
import {
  AI_CONTENT_SCHEMA_VERSION,
  hashAiContent,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";

const APP_ID = "11111111-1111-4111-9111-111111111111";
const USER_ID = "user-1";

function makeAiContent(overrides: Partial<AiContent> = {}): AiContent {
  return {
    schemaVersion: AI_CONTENT_SCHEMA_VERSION,
    generatedAt: "2026-05-09T00:00:00.000Z",
    promptMetaHash: "p1",
    cv: {
      summary: { aiText: "ai", originalText: "orig", accepted: true },
      latestExperience: { experienceIndex: 0, addedBullets: [] },
      skillsAdditions: [],
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

describe("PATCH /api/applications/[id]/draft", () => {
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
  });

  it("writes aiContent + DRAFT status and returns the new hash", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    const incoming = makeAiContent();
    prisma.application.findFirst.mockResolvedValueOnce({
      id: APP_ID,
      userId: USER_ID,
      jobId: "job-1",
      aiContentHash: null,
    });
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
  });

  it("returns 409 when expectedHash does not match the current row", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
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
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    prisma.application.findFirst.mockResolvedValueOnce(null);

    const res = await PATCH(
      makeRequest({ aiContent: makeAiContent(), expectedHash: null }),
      { params },
    );

    expect(res.status).toBe(404);
  });

  it("rejects malformed aiContent payloads with 400", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });

    const res = await PATCH(
      makeRequest({ aiContent: { wrong: true }, expectedHash: null }),
      { params },
    );

    expect(res.status).toBe(400);
    expect(prisma.application.findFirst).not.toHaveBeenCalled();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await PATCH(
      makeRequest({ aiContent: makeAiContent(), expectedHash: null }),
      { params },
    );

    expect(res.status).toBe(401);
  });

  it("returns 409 when another tab writes after the initial hash check", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
    prisma.application.findFirst.mockResolvedValueOnce({
      id: APP_ID,
      userId: USER_ID,
      jobId: "job-1",
      aiContentHash: "expected",
    });
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
});
