import { beforeEach, describe, expect, it, vi } from "vitest";

const applicationPrompt = vi.hoisted(() => ({
  build: vi.fn(),
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
import {
  ApplicationPromptError,
  type ApplicationPromptPayload,
} from "@/lib/server/applications/applicationPrompt";
import { POST } from "@/app/api/applications/prompt/route";

const VALID_JOB_ID = "550e8400-e29b-41d4-a716-446655440000";

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

function request(body: unknown) {
  return new Request("http://localhost/api/applications/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("applications prompt api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    applicationPrompt.build.mockResolvedValue(servicePayload);
  });

  it("requires a session", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const response = await POST(request({ jobId: VALID_JOB_ID, target: "resume" }));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error.code).toBe("UNAUTHORIZED");
    expect(applicationPrompt.build).not.toHaveBeenCalled();
  });

  it("strictly rejects invalid or over-posted bodies with the existing envelope", async () => {
    const response = await POST(
      request({ jobId: VALID_JOB_ID, target: "resume", userId: "attacker" }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.code).toBe("INVALID_BODY");
    expect(json.error.message).toBe("Invalid request body");
    expect(json.error.details).toBeDefined();
    expect(typeof json.requestId).toBe("string");
    expect(applicationPrompt.build).not.toHaveBeenCalled();
  });

  it("delegates authenticated business orchestration and returns the v3 envelope", async () => {
    const response = await POST(request({ jobId: VALID_JOB_ID, target: "resume" }));
    const json = await response.json();

    expect(applicationPrompt.build).toHaveBeenCalledWith({
      userId: "user-1",
      jobId: VALID_JOB_ID,
      target: "resume",
    });
    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      prompt: {
        ...servicePayload.prompt,
        systemPrompt: servicePayload.prompt.instructions,
        userPrompt: servicePayload.prompt.input,
        shortUserPrompt: "",
      },
      promptMeta: servicePayload.promptMeta,
      expectedJsonShape: servicePayload.expectedJsonShape,
      expectedJsonSchema: servicePayload.expectedJsonSchema,
      promptVersion: "v3-local-ai",
    });
    expect(json.requestId).not.toBe(servicePayload.requestId);
    expect(json.requestId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it.each([
    ["JOB_NOT_FOUND", "Job not found", 404],
    ["NO_PROFILE", "Create and save your master resume before generating prompt.", 404],
    ["PROMPT_TOO_LARGE", "Application prompt exceeds the size limit.", 413],
  ] as const)("maps %s service errors into the existing JSON envelope", async (code, message, status) => {
    applicationPrompt.build.mockRejectedValueOnce(
      new ApplicationPromptError(code, message, status),
    );

    const response = await POST(request({ jobId: VALID_JOB_ID, target: "cover" }));
    const json = await response.json();

    expect(response.status).toBe(status);
    expect(json.error).toEqual({ code, message });
    expect(typeof json.requestId).toBe("string");
  });
});
