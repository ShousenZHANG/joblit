import { beforeEach, describe, expect, it, vi } from "vitest";

const applicationEdit = vi.hoisted(() => ({
  discardApplicationEdits: vi.fn(),
}));

vi.mock("@/lib/server/applications/applicationEdit", () => applicationEdit);
vi.mock("@/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/applications/[id]/discard/route";
import type { ApplicationPublication } from "@/lib/shared/applicationPublication";
import {
  AI_CONTENT_SCHEMA_VERSION,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";

const APP_ID = "33333333-3333-4333-9333-333333333333";
const USER_ID = "user-1";
const EXPECTED_HASH = "expected-hash";

const aiContent: AiContent = {
  schemaVersion: AI_CONTENT_SCHEMA_VERSION,
  generatedAt: "2026-05-09T00:00:00.000Z",
  promptMetaHash: "p1",
  cv: {
    summary: { aiText: "Tailored summary", originalText: "Original", accepted: true },
    skillsSelection: { aiSelection: [{ group: 0, items: [0] }] },
  },
  cover: {
    paragraphOne: { aiText: "", accepted: false },
    paragraphTwo: { aiText: "", accepted: false },
    paragraphThree: { aiText: "", accepted: false },
  },
};

const publication: ApplicationPublication = {
  status: "DRAFT",
  resume: {
    status: "DRAFT",
    contentHash: "resume-content-hash",
    publishedHash: null,
  },
  cover: { status: "MISSING", contentHash: null, publishedHash: null },
};

function request(body: unknown = { expectedHash: EXPECTED_HASH }) {
  return new Request(`http://localhost/api/applications/${APP_ID}/discard`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routeContext(id = APP_ID) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/applications/[id]/discard", () => {
  beforeEach(() => {
    vi.mocked(getServerSession).mockReset().mockResolvedValue({
      user: { id: USER_ID },
    });
    applicationEdit.discardApplicationEdits.mockReset();
  });

  it("passes the authenticated Application identity and CAS hash to the module", async () => {
    applicationEdit.discardApplicationEdits.mockResolvedValue({
      kind: "committed",
      aiContent,
      aiContentHash: "next-hash",
      publication,
    });

    const response = await POST(request(), routeContext());

    expect(response.status).toBe(200);
    expect(applicationEdit.discardApplicationEdits).toHaveBeenCalledOnce();
    expect(applicationEdit.discardApplicationEdits).toHaveBeenCalledWith({
      userId: USER_ID,
      applicationId: APP_ID,
      expectedHash: EXPECTED_HASH,
    });
  });

  it("returns the committed Application Edit snapshot without adding adapter fields", async () => {
    applicationEdit.discardApplicationEdits.mockResolvedValue({
      kind: "committed",
      aiContent,
      aiContentHash: "next-hash",
      publication,
    });

    const response = await POST(request(), routeContext());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      status: "DRAFT",
      publication,
      aiContent,
      aiContentHash: "next-hash",
      requestId: expect.any(String),
    });
  });

  it("returns 401 without entering the module when unauthenticated", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const response = await POST(request(), routeContext());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "UNAUTHORIZED", message: "Unauthorized" },
    });
    expect(applicationEdit.discardApplicationEdits).not.toHaveBeenCalled();
  });

  it("rejects an invalid Application id before entering the module", async () => {
    const response = await POST(request(), routeContext("not-a-uuid"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_PARAMS",
        message: "Invalid route parameters",
      },
      requestId: expect.any(String),
    });
    expect(applicationEdit.discardApplicationEdits).not.toHaveBeenCalled();
  });

  it("rejects an invalid body before entering the module", async () => {
    const response = await POST(request({ expectedHash: 42 }), routeContext());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_BODY",
        message: "Invalid request body",
        details: expect.any(Object),
      },
      requestId: expect.any(String),
    });
    expect(applicationEdit.discardApplicationEdits).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "not found",
      result: { kind: "not_found" },
      status: 404,
      body: {
        error: { code: "NOT_FOUND", message: "Application not found" },
      },
    },
    {
      name: "stale write",
      result: { kind: "stale_write", currentHash: "current-hash" },
      status: 409,
      body: {
        error: {
          code: "STALE_WRITE",
          message: "Another tab updated this draft",
        },
        currentHash: "current-hash",
      },
    },
    {
      name: "stale write whose current hash is null",
      result: { kind: "stale_write", currentHash: null },
      status: 409,
      body: {
        error: {
          code: "STALE_WRITE",
          message: "Another tab updated this draft",
        },
        currentHash: null,
      },
    },
    {
      name: "stale write whose winning row cannot be observed",
      result: { kind: "stale_write" },
      status: 409,
      body: {
        error: {
          code: "STALE_WRITE",
          message: "Another tab updated this draft",
        },
      },
    },
    {
      name: "missing AI Content",
      result: { kind: "no_ai_content" },
      status: 400,
      body: {
        error: {
          code: "NO_AI_CONTENT",
          message: "No AI content to discard",
        },
      },
    },
    {
      name: "invalid stored AI Content",
      result: { kind: "invalid_ai_content" },
      status: 500,
      body: {
        error: {
          code: "AI_CONTENT_INVALID",
          message: "Stored aiContent failed schema validation",
        },
      },
    },
    {
      name: "stale render context",
      result: { kind: "stale_render_context" },
      status: 409,
      body: {
        error: {
          code: "STALE_RENDER_CONTEXT",
          message:
            "Your resume profile or job changed while edits were being discarded. Try again.",
        },
      },
    },
  ])("maps $name to the existing HTTP contract", async ({ result, status, body }) => {
    applicationEdit.discardApplicationEdits.mockResolvedValue(result);

    const response = await POST(request(), routeContext());
    const json = await response.json();

    expect(response.status).toBe(status);
    expect(json).toEqual({ ...body, requestId: expect.any(String) });
  });
});
