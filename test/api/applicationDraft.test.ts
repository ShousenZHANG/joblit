import { beforeEach, describe, expect, it, vi } from "vitest";

const applicationEdit = vi.hoisted(() => ({
  autoSaveApplicationEdit: vi.fn(),
}));

vi.mock("@/lib/server/applications/applicationEdit", () => ({
  autoSaveApplicationEdit: applicationEdit.autoSaveApplicationEdit,
}));
vi.mock("@/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { PATCH } from "@/app/api/applications/[id]/draft/route";
import {
  AI_CONTENT_SCHEMA_VERSION,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";

const APP_ID = "11111111-1111-4111-9111-111111111111";
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
      paragraphOne: { aiText: "one", accepted: true },
      paragraphTwo: { aiText: "two", accepted: true },
      paragraphThree: { aiText: "three", accepted: true },
    },
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

describe("PATCH /api/applications/[id]/draft adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: USER_ID } });
    applicationEdit.autoSaveApplicationEdit.mockResolvedValue({
      kind: "not_found",
    });
  });

  it("returns the auth adapter response before calling Application Edit", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const response = await PATCH(
      makeRequest({ aiContent: makeAiContent(), expectedHash: null }),
      { params },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "UNAUTHORIZED", message: "Unauthorized" },
    });
    expect(applicationEdit.autoSaveApplicationEdit).not.toHaveBeenCalled();
  });

  it("rejects an invalid Application id before calling Application Edit", async () => {
    const response = await PATCH(
      makeRequest({ aiContent: makeAiContent(), expectedHash: null }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({
      error: {
        code: "INVALID_PARAMS",
        message: "Invalid route parameters",
      },
      requestId: expect.any(String),
    });
    expect(applicationEdit.autoSaveApplicationEdit).not.toHaveBeenCalled();
  });

  it("rejects an invalid body before calling Application Edit", async () => {
    const response = await PATCH(
      makeRequest({ aiContent: { wrong: true }, expectedHash: null }),
      { params },
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({
      error: {
        code: "INVALID_BODY",
        message: "Invalid request body",
        details: expect.any(Object),
      },
      requestId: expect.any(String),
    });
    expect(applicationEdit.autoSaveApplicationEdit).not.toHaveBeenCalled();
  });

  it("passes only the caller-shaped save command to Application Edit", async () => {
    const aiContent = makeAiContent();
    const response = await PATCH(
      makeRequest({ aiContent, expectedHash: "expected-hash" }),
      { params },
    );

    expect(response.status).toBe(404);
    expect(applicationEdit.autoSaveApplicationEdit).toHaveBeenCalledOnce();
    expect(applicationEdit.autoSaveApplicationEdit).toHaveBeenCalledWith({
      userId: USER_ID,
      applicationId: APP_ID,
      expectedHash: "expected-hash",
      submittedAiContent: aiContent,
    });
  });

  it("maps a committed edit to the exact success JSON", async () => {
    const aiContent = makeAiContent();
    const publication = {
      status: "DRAFT" as const,
      resume: {
        status: "DRAFT" as const,
        contentHash: "resume-current",
        publishedHash: "resume-published",
      },
      cover: {
        status: "FINAL" as const,
        contentHash: "cover-current",
        publishedHash: "cover-current",
      },
    };
    applicationEdit.autoSaveApplicationEdit.mockResolvedValueOnce({
      kind: "committed",
      aiContent,
      aiContentHash: "new-hash",
      publication,
    });

    const response = await PATCH(
      makeRequest({ aiContent, expectedHash: null }),
      { params },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      status: "DRAFT",
      publication,
      aiContent,
      aiContentHash: "new-hash",
      requestId: expect.any(String),
    });
  });

  it("maps not_found to the exact 404 JSON", async () => {
    applicationEdit.autoSaveApplicationEdit.mockResolvedValueOnce({
      kind: "not_found",
    });

    const response = await PATCH(
      makeRequest({ aiContent: makeAiContent(), expectedHash: null }),
      { params },
    );
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json).toEqual({
      error: { code: "NOT_FOUND", message: "Application not found" },
      requestId: expect.any(String),
    });
  });

  it("maps stale_write with currentHash at the response top level", async () => {
    applicationEdit.autoSaveApplicationEdit.mockResolvedValueOnce({
      kind: "stale_write",
      currentHash: "current-hash",
    });

    const response = await PATCH(
      makeRequest({ aiContent: makeAiContent(), expectedHash: "old-hash" }),
      { params },
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toEqual({
      error: {
        code: "STALE_WRITE",
        message: "Another tab updated this draft",
      },
      currentHash: "current-hash",
      requestId: expect.any(String),
    });
    expect(json.error).not.toHaveProperty("currentHash");
  });

  it("preserves a null currentHash at the response top level", async () => {
    applicationEdit.autoSaveApplicationEdit.mockResolvedValueOnce({
      kind: "stale_write",
      currentHash: null,
    });

    const response = await PATCH(
      makeRequest({ aiContent: makeAiContent(), expectedHash: "old-hash" }),
      { params },
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toEqual({
      error: {
        code: "STALE_WRITE",
        message: "Another tab updated this draft",
      },
      currentHash: null,
      requestId: expect.any(String),
    });
  });

  it("omits currentHash when the module cannot observe the winning row", async () => {
    applicationEdit.autoSaveApplicationEdit.mockResolvedValueOnce({
      kind: "stale_write",
    });

    const response = await PATCH(
      makeRequest({ aiContent: makeAiContent(), expectedHash: "old-hash" }),
      { params },
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toEqual({
      error: {
        code: "STALE_WRITE",
        message: "Another tab updated this draft",
      },
      requestId: expect.any(String),
    });
    expect(json).not.toHaveProperty("currentHash");
  });

  it("maps invalid_ai_content to the exact 500 JSON", async () => {
    applicationEdit.autoSaveApplicationEdit.mockResolvedValueOnce({
      kind: "invalid_ai_content",
    });

    const response = await PATCH(
      makeRequest({ aiContent: makeAiContent(), expectedHash: null }),
      { params },
    );
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json).toEqual({
      error: {
        code: "AI_CONTENT_INVALID",
        message: "Stored aiContent failed schema validation",
      },
      requestId: expect.any(String),
    });
  });

  it("maps unavailable canonical evidence to the exact 409 JSON", async () => {
    applicationEdit.autoSaveApplicationEdit.mockResolvedValueOnce({
      kind: "canonical_evidence_unavailable",
    });

    const response = await PATCH(
      makeRequest({ aiContent: makeAiContent(), expectedHash: null }),
      { params },
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toEqual({
      error: {
        code: "CANONICAL_EVIDENCE_UNAVAILABLE",
        message:
          "The server source snapshot is unavailable. Re-generate this draft.",
      },
      requestId: expect.any(String),
    });
  });

  it("maps stale_render_context to the draft-specific 409 JSON", async () => {
    applicationEdit.autoSaveApplicationEdit.mockResolvedValueOnce({
      kind: "stale_render_context",
    });

    const response = await PATCH(
      makeRequest({ aiContent: makeAiContent(), expectedHash: null }),
      { params },
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toEqual({
      error: {
        code: "STALE_RENDER_CONTEXT",
        message:
          "Your resume profile or job changed while this draft was saving. Try again.",
      },
      requestId: expect.any(String),
    });
  });
});
