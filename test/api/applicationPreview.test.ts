import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  application: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
}));
const renderer = vi.hoisted(() => ({
  renderApplicationPdf: vi.fn(),
  renderCoverLetterPdf: vi.fn(),
  renderFinalApplication: vi.fn(),
  renderFinalCoverLetter: vi.fn(),
}));
const renderLimiter = vi.hoisted(() => ({
  enforce: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({ prisma }));
vi.mock("@/lib/server/applications/finalizeApplication", () => renderer);
vi.mock("@/lib/server/api/applicationRenderRateLimit", () => ({
  enforceApplicationRenderRateLimit: renderLimiter.enforce,
}));
vi.mock("@/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/applications/[id]/preview/route";
import {
  AI_CONTENT_SCHEMA_VERSION,
  hashAiContent,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";

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
      skillsAdditions: [],
    },
    cover: {
      paragraphOne: { aiText: "one", accepted: true },
      paragraphTwo: { aiText: "two", accepted: true },
      paragraphThree: { aiText: "three", accepted: true },
    },
  };
}

function makeRequest(expectedHash: string, target = "resume") {
  return new Request(
    `http://localhost/api/applications/${APP_ID}/preview?target=${target}`,
    {
      method: "POST",
      body: JSON.stringify({ expectedHash }),
      headers: { "content-type": "application/json" },
    },
  );
}

const params = Promise.resolve({ id: APP_ID });

describe("POST /api/applications/[id]/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderLimiter.enforce.mockReturnValue(null);
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: USER_ID },
    });
  });

  it("streams a private resume PDF without persisting or uploading an artifact", async () => {
    const aiContent = makeAiContent();
    const hash = hashAiContent(aiContent);
    prisma.application.findFirst.mockResolvedValue({
      id: APP_ID,
      aiContent,
      aiContentHash: hash,
      jobId: "job-1",
      company: "Acme",
      role: "Engineer",
      job: {
        id: "job-1",
        title: "Engineer",
        company: "Acme",
        market: "AU",
      },
    });
    renderer.renderApplicationPdf.mockResolvedValue({
      pdf: Buffer.from("%PDF-preview"),
      filename: "resume.pdf",
    });

    const response = await POST(makeRequest(hash), { params });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toBe("%PDF-preview");
    expect(renderer.renderApplicationPdf).toHaveBeenCalledOnce();
    expect(renderer.renderFinalApplication).not.toHaveBeenCalled();
    expect(prisma.application.update).not.toHaveBeenCalled();
    expect(renderLimiter.enforce).toHaveBeenCalledWith(
      USER_ID,
      expect.any(String),
    );
  });

  it("renders the cover target through the non-persisting renderer", async () => {
    const aiContent = makeAiContent();
    const hash = hashAiContent(aiContent);
    prisma.application.findFirst.mockResolvedValue({
      id: APP_ID,
      aiContent,
      aiContentHash: hash,
      jobId: null,
      company: "Acme",
      role: "Engineer",
      job: null,
    });
    renderer.renderCoverLetterPdf.mockResolvedValue({
      pdf: Buffer.from("%PDF-cover"),
      filename: "cover.pdf",
    });

    const response = await POST(makeRequest(hash, "cover"), { params });

    expect(response.status).toBe(200);
    expect(renderer.renderCoverLetterPdf).toHaveBeenCalledOnce();
    expect(renderer.renderFinalCoverLetter).not.toHaveBeenCalled();
    expect(prisma.application.update).not.toHaveBeenCalled();
  });

  it("rejects a stale draft before rendering", async () => {
    const aiContent = makeAiContent();
    prisma.application.findFirst.mockResolvedValue({
      id: APP_ID,
      aiContent,
      aiContentHash: "current",
      jobId: null,
      company: null,
      role: null,
      job: null,
    });

    const response = await POST(makeRequest("stale"), { params });

    expect(response.status).toBe(409);
    expect(renderer.renderApplicationPdf).not.toHaveBeenCalled();
    expect(renderer.renderCoverLetterPdf).not.toHaveBeenCalled();
    expect(renderLimiter.enforce).not.toHaveBeenCalled();
  });

  it("checks ownership before consuming the user render budget", async () => {
    prisma.application.findFirst.mockResolvedValue(null);

    const response = await POST(makeRequest("missing"), { params });

    expect(response.status).toBe(404);
    expect(renderLimiter.enforce).not.toHaveBeenCalled();
    expect(renderer.renderApplicationPdf).not.toHaveBeenCalled();
  });

  it("returns the shared user-level limiter response before compiling", async () => {
    const aiContent = makeAiContent();
    const hash = hashAiContent(aiContent);
    prisma.application.findFirst.mockResolvedValue({
      id: APP_ID,
      aiContent,
      aiContentHash: hash,
      jobId: null,
      company: null,
      role: "Engineer",
      job: null,
    });
    renderLimiter.enforce.mockReturnValueOnce(
      new Response(JSON.stringify({ error: { code: "RATE_LIMITED" } }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await POST(makeRequest(hash), { params });

    expect(response.status).toBe(429);
    expect(renderer.renderApplicationPdf).not.toHaveBeenCalled();
  });
});
