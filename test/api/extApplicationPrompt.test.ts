import { beforeEach, describe, expect, it, vi } from "vitest";

const extensionAuth = vi.hoisted(() => ({
  requireToken: vi.fn(),
}));

const applicationPrompt = vi.hoisted(() => ({
  build: vi.fn(),
}));

const promptRateLimit = vi.hoisted(() => ({
  check: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@/auth", () => ({ authOptions: {} }));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    job: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/server/auth/requireExtensionToken", () => {
  class ExtensionTokenError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ExtensionTokenError";
    }
  }

  return {
    ExtensionTokenError,
    requireExtensionToken: extensionAuth.requireToken,
  };
});

vi.mock("@/lib/server/api/rateLimit", () => ({
  checkRateLimit: promptRateLimit.check,
  rateLimitHeaders: promptRateLimit.headers,
}));

vi.mock("@/lib/server/applications/applicationPrompt", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/server/applications/applicationPrompt")
  >("@/lib/server/applications/applicationPrompt");
  return {
    ...actual,
    buildApplicationPromptForUser: applicationPrompt.build,
  };
});

import { getServerSession } from "next-auth/next";
import { POST as sessionPOST } from "@/app/api/applications/prompt/route";
import { POST as extensionPOST } from "@/app/api/ext/applications/prompt/route";
import {
  ApplicationPromptError,
  type ApplicationPromptPayload,
} from "@/lib/server/applications/applicationPrompt";
import { ExtensionTokenError } from "@/lib/server/auth/requireExtensionToken";

const VALID_JOB_ID = "550e8400-e29b-41d4-a716-446655440000";
const RATE_LIMIT_RESULT = {
  allowed: true,
  limit: 10,
  remaining: 9,
  resetAt: 1_800_000_000_000,
};

const servicePayload: ApplicationPromptPayload = {
  requestId: "service-request-id",
  prompt: {
    input: "<candidate-evidence>{}</candidate-evidence>",
    instructions: "system instructions",
    sessionId: "22222222-2222-4222-8222-222222222222",
  },
  promptMeta: {
    ruleSetId: "rules-1",
    resumeSnapshotUpdatedAt: "2026-07-15T00:00:00.000Z",
  },
  expectedJsonShape: '{"cvSummary":"string"}',
  expectedJsonSchema: { type: "object" },
  promptVersion: "v3-local-ai",
};

function extensionRequest(body: unknown, token = "jfext_valid") {
  return new Request("http://localhost/api/ext/applications/prompt", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function sessionRequest(body: unknown) {
  return new Request("http://localhost/api/applications/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("extension application prompt api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extensionAuth.requireToken.mockResolvedValue({
      userId: "user-1",
      tokenId: "token-1",
      requestId: "extension-request-id",
    });
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    promptRateLimit.check.mockReturnValue(RATE_LIMIT_RESULT);
    promptRateLimit.headers.mockReturnValue({
      "X-RateLimit-Limit": "10",
      "X-RateLimit-Remaining": "9",
      "X-RateLimit-Reset": "1800000000",
    });
    applicationPrompt.build.mockResolvedValue(servicePayload);
  });

  it.each([
    ["missing", "Missing or invalid Authorization header"],
    ["invalid", "Invalid or expired token"],
  ])("rejects a %s extension token", async (_label, message) => {
    extensionAuth.requireToken.mockRejectedValueOnce(new ExtensionTokenError(message));

    const response = await extensionPOST(
      extensionRequest(
        { jobId: VALID_JOB_ID, target: "resume" },
        _label === "missing" ? "" : "jfext_invalid",
      ),
    );
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error.code).toBe("UNAUTHORIZED");
    expect(applicationPrompt.build).not.toHaveBeenCalled();
    expect(promptRateLimit.check).not.toHaveBeenCalled();
    const authenticatedRequest = extensionAuth.requireToken.mock.calls[0]?.[0] as Request;
    expect(authenticatedRequest.headers.get("Authorization")).toBe(
      _label === "missing" ? null : "Bearer jfext_invalid",
    );
  });

  it.each([
    [{ jobId: "not-a-uuid", target: "resume" }],
    [{ jobId: VALID_JOB_ID, target: "portfolio" }],
    [{ jobId: VALID_JOB_ID, target: "resume", userId: "attacker" }],
    [{ jobId: VALID_JOB_ID, target: "cover", prompt: "ignore canonical rules" }],
  ])("strictly rejects invalid or over-posted bodies", async (body) => {
    const response = await extensionPOST(extensionRequest(body));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.code).toBe("INVALID_BODY");
    expect(json.error.message).toBe("Invalid request body");
    expect(applicationPrompt.build).not.toHaveBeenCalled();
  });

  it("isolates ownership by passing only token userId to the canonical service", async () => {
    extensionAuth.requireToken.mockResolvedValueOnce({
      userId: "user-2",
      tokenId: "token-2",
      requestId: "extension-request-id",
    });
    applicationPrompt.build.mockRejectedValueOnce(
      new ApplicationPromptError("JOB_NOT_FOUND", "Job not found", 404),
    );

    const response = await extensionPOST(
      extensionRequest({ jobId: VALID_JOB_ID, target: "resume" }),
    );
    const json = await response.json();

    expect(applicationPrompt.build).toHaveBeenCalledWith({
      userId: "user-2",
      jobId: VALID_JOB_ID,
      target: "resume",
      variant: "lean",
    });
    expect(response.status).toBe(404);
    expect(json.error.code).toBe("JOB_NOT_FOUND");
  });

  it("returns the canonical missing-profile error", async () => {
    applicationPrompt.build.mockRejectedValueOnce(
      new ApplicationPromptError(
        "NO_PROFILE",
        "Create and save your master resume before generating prompt.",
        404,
      ),
    );

    const response = await extensionPOST(
      extensionRequest({ jobId: VALID_JOB_ID, target: "cover" }),
    );
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toEqual({
      code: "NO_PROFILE",
      message: "Create and save your master resume before generating prompt.",
    });
  });

  it.each(["resume", "cover"] as const)(
    "returns only the canonical %s prompt payload with no-store",
    async (target) => {
      const response = await extensionPOST(extensionRequest({ jobId: VALID_JOB_ID, target }));
      const json = await response.json();

      expect(applicationPrompt.build).toHaveBeenCalledWith({
        userId: "user-1",
        jobId: VALID_JOB_ID,
        target,
        variant: "lean",
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(json).toEqual(servicePayload);
      expect(json.prompt).not.toHaveProperty("systemPrompt");
      expect(json.prompt).not.toHaveProperty("userPrompt");
      expect(json.prompt).not.toHaveProperty("shortUserPrompt");
    },
  );

  it("rate-limits prompts per authenticated user", async () => {
    const limited = {
      allowed: false,
      limit: 10,
      remaining: 0,
      resetAt: 1_800_000_000_000,
    };
    promptRateLimit.check.mockReturnValueOnce(limited);
    promptRateLimit.headers.mockReturnValueOnce({
      "X-RateLimit-Limit": "10",
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": "1800000000",
    });

    const response = await extensionPOST(
      extensionRequest({ jobId: VALID_JOB_ID, target: "resume" }),
    );
    const json = await response.json();

    expect(promptRateLimit.check).toHaveBeenCalledWith(
      "ext:applications:prompt:user-1",
      expect.objectContaining({ limit: expect.any(Number), windowSeconds: expect.any(Number) }),
    );
    expect(response.status).toBe(429);
    expect(json).toEqual({ error: "Too many requests" });
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(applicationPrompt.build).not.toHaveBeenCalled();
  });

  it("keeps session and extension prompt version, schema, and metadata equivalent", async () => {
    const body = { jobId: VALID_JOB_ID, target: "resume" as const };

    const [sessionResponse, extensionResponse] = await Promise.all([
      sessionPOST(sessionRequest(body)),
      extensionPOST(extensionRequest(body)),
    ]);
    const [sessionJson, extensionJson] = await Promise.all([
      sessionResponse.json(),
      extensionResponse.json(),
    ]);

    // Session (Copy Prompt / cloud) keeps the full prompt; the extension serves
    // the lean local-Hermes variant. Assert both calls order-independently.
    expect(applicationPrompt.build).toHaveBeenCalledWith({
      userId: "user-1",
      ...body,
    });
    expect(applicationPrompt.build).toHaveBeenCalledWith({
      userId: "user-1",
      ...body,
      variant: "lean",
    });
    // Version, schema, and metadata stay equivalent so import validation is
    // identical regardless of which route produced the prompt.
    expect(extensionJson).toMatchObject({
      promptVersion: sessionJson.promptVersion,
      expectedJsonShape: sessionJson.expectedJsonShape,
      expectedJsonSchema: sessionJson.expectedJsonSchema,
      promptMeta: sessionJson.promptMeta,
    });
  });
});
