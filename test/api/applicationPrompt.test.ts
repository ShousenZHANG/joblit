import { beforeEach, describe, expect, it, vi } from "vitest";

const applicationPrompt = vi.hoisted(() => ({
  build: vi.fn(),
}));

const tailoringRuns = vi.hoisted(() => ({
  issuePrompt: vi.fn(),
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

vi.mock("@/lib/server/tailoringRuns/issuePromptTailoringRun", () => ({
  issuePromptTailoringRun: tailoringRuns.issuePrompt,
}));

import { getServerSession } from "next-auth/next";
import {
  ApplicationPromptError,
  type ApplicationPromptPayload,
} from "@/lib/server/applications/applicationPrompt";
import { buildPromptMeta } from "@/lib/server/ai/promptContract";
import { POST } from "@/app/api/applications/prompt/route";

const VALID_JOB_ID = "550e8400-e29b-41d4-a716-446655440000";
const ISSUE_KEY = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const TAILORING_RUN = {
  id: "8f8f8f8f-8f8f-4f8f-8f8f-8f8f8f8f8f8f",
  attemptId: "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a",
};

const servicePayload: ApplicationPromptPayload = {
  requestId: "service-request-id",
  prompt: {
    input: "<candidate-evidence>{}</candidate-evidence>",
    instructions: "system instructions",
    sessionId: "22222222-2222-4222-8222-222222222222",
  },
  promptMeta: buildPromptMeta({
    target: "resume",
    ruleSetId: "rules-1",
    resumeSnapshotUpdatedAt: "2026-07-15T00:00:00.000Z",
    variant: "full",
    prompt: {
      input: "<candidate-evidence>{}</candidate-evidence>",
      instructions: "system instructions",
    },
  }),
  expectedJsonShape: '{"cvSummary":"string"}',
  expectedJsonSchema: { type: "object" },
  promptVersion: "v4-application-proposal",
  snapshotBinding: {
    resumeProfileId: "profile-1",
    resumeSnapshotHash: "resume-snapshot-hash",
    jobSnapshotHash: "job-snapshot-hash",
  },
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
    tailoringRuns.issuePrompt.mockResolvedValue(TAILORING_RUN);
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

  it.each(["resume", "cover"] as const)(
    "issues a durable %s run and returns its handle in the v4 envelope",
    async (target) => {
      const response = await POST(request({
        jobId: VALID_JOB_ID,
        target,
        source: "manual_import",
        delivery: "DRAFT",
        issueKey: ISSUE_KEY,
      }));
      const json = await response.json();

      expect(applicationPrompt.build).toHaveBeenCalledWith({
        userId: "user-1",
        jobId: VALID_JOB_ID,
        target,
      });
      expect(tailoringRuns.issuePrompt).toHaveBeenCalledWith({
        userId: "user-1",
        jobId: VALID_JOB_ID,
        target,
        source: "MANUAL_IMPORT",
        delivery: "DRAFT",
        issueKey: ISSUE_KEY,
        payload: servicePayload,
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
        promptVersion: "v4-application-proposal",
        tailoringRun: TAILORING_RUN,
      });
      expect(json.requestId).not.toBe(servicePayload.requestId);
      expect(json.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    },
  );

  it("builds a match prompt without issuing a TailoringRun", async () => {
    const response = await POST(request({
      jobId: VALID_JOB_ID,
      target: "match",
      source: "manual_import",
      delivery: "DRAFT",
      issueKey: ISSUE_KEY,
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(applicationPrompt.build).toHaveBeenCalledWith({
      userId: "user-1",
      jobId: VALID_JOB_ID,
      target: "match",
    });
    expect(tailoringRuns.issuePrompt).not.toHaveBeenCalled();
    expect(json).not.toHaveProperty("tailoringRun");
  });

  it.each([
    ["JOB_NOT_FOUND", "Job not found", 404],
    ["NO_PROFILE", "Create and save your master resume before generating prompt.", 404],
    ["PROMPT_TOO_LARGE", "Application prompt is too large to process.", 413],
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
