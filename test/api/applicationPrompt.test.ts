import { beforeEach, describe, expect, it, vi } from "vitest";

const applicationPrompt = vi.hoisted(() => ({
  build: vi.fn(),
}));

const tailoringRuns = vi.hoisted(() => ({
  issuePrompt: vi.fn(),
}));

const agentAuth = vi.hoisted(() => ({
  requireAgentCredential: vi.fn(),
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

vi.mock("@/lib/server/auth/requireAgentCredential", () => ({
  requireAgentCredential: agentAuth.requireAgentCredential,
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

function request(body: unknown, bearer = false) {
  return new Request("http://localhost/api/applications/prompt", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: "Bearer agent-token" } : {}),
    },
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
    agentAuth.requireAgentCredential.mockResolvedValue({
      userId: "user-1",
      credentialId: "credential-1",
      capabilities: ["tailoring:execute"],
      requestId: "agent-request-id",
    });
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
