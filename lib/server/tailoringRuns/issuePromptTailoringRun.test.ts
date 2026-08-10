import { beforeEach, describe, expect, it, vi } from "vitest";

import { TailoringRunError } from "./tailoringRunProtocol";

const lifecycle = vi.hoisted(() => ({
  issue: vi.fn(),
  start: vi.fn(),
  bind: vi.fn(),
  fail: vi.fn(),
}));

vi.mock("./tailoringRunService", () => ({
  issueTailoringRun: lifecycle.issue,
  startTailoringRun: lifecycle.start,
  bindTailoringRunPrompt: lifecycle.bind,
  failTailoringRun: lifecycle.fail,
}));

import { issuePromptTailoringRun } from "./issuePromptTailoringRun";

const RUN_ID = "8f8f8f8f-8f8f-4f8f-8f8f-8f8f8f8f8f8f";
const ATTEMPT_ID = "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a";
const input = {
  userId: "user-1",
  jobId: "job-1",
  target: "resume" as const,
  source: "MANUAL_IMPORT" as const,
  delivery: "DRAFT" as const,
  issueKey: "manual-key",
  payload: {
    requestId: "request-1",
    prompt: {
      input: "candidate evidence",
      instructions: "strict instructions",
      sessionId: "public-session",
    },
    promptMeta: {
      promptHash: "prompt-hash",
      ruleSetId: "rules-1",
      resumeSnapshotUpdatedAt: "2026-07-26T00:00:00.000Z",
      promptTemplateVersion: "template-v1",
      schemaVersion: "schema-v1",
      skillPackVersion: "skills-v1",
    },
    expectedJsonShape: "{}",
    expectedJsonSchema: { type: "object" },
    promptVersion: "v4-application-proposal" as const,
    snapshotBinding: {
      resumeProfileId: "profile-1",
      resumeSnapshotHash: "resume-hash",
      jobSnapshotHash: "job-hash",
    },
  },
};

describe("issuePromptTailoringRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lifecycle.issue.mockResolvedValue({ run: { id: RUN_ID } });
    lifecycle.start.mockResolvedValue({
      handle: { id: RUN_ID, attemptId: ATTEMPT_ID },
    });
    lifecycle.bind.mockResolvedValue({ disposition: "APPLIED" });
    lifecycle.fail.mockResolvedValue({ disposition: "APPLIED" });
  });

  it("terminates an interactive run whose stable key points at an old prompt", async () => {
    lifecycle.bind.mockRejectedValueOnce(
      new TailoringRunError(
        "PROMPT_CONFLICT",
        "Prompt metadata changed",
      ),
    );

    await expect(issuePromptTailoringRun(input)).rejects.toMatchObject({
      code: "PROMPT_CONFLICT",
    });
    expect(lifecycle.fail).toHaveBeenCalledWith({
      userId: input.userId,
      handle: { id: RUN_ID, attemptId: ATTEMPT_ID },
      errorCode: "PROMPT_SUPERSEDED",
      errorMessage: "Prompt contract changed before acceptance",
    });
  });

  it("does not hide or independently terminate a batch prompt conflict", async () => {
    lifecycle.bind.mockRejectedValueOnce(
      new TailoringRunError(
        "PROMPT_CONFLICT",
        "Prompt metadata changed",
      ),
    );

    await expect(
      issuePromptTailoringRun({
        ...input,
        source: "CODEX_BATCH",
        delivery: "FINAL",
        batch: {
          batchId: "batch-1",
          taskId: "task-1",
          executionAttemptId: ATTEMPT_ID,
        },
      }),
    ).rejects.toMatchObject({ code: "PROMPT_CONFLICT" });
    expect(lifecycle.fail).not.toHaveBeenCalled();
  });

  it("requires both documents to publish for a protocol-v2 draft batch", async () => {
    await issuePromptTailoringRun({
      ...input,
      source: "CODEX_BATCH",
      delivery: "DRAFT",
      batch: {
        batchId: "batch-1",
        taskId: "task-1",
        executionAttemptId: ATTEMPT_ID,
      },
    });

    expect(lifecycle.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: "DRAFT",
        requiredTargets: ["RESUME", "COVER"],
        publicationRequiredTargets: ["RESUME", "COVER"],
      }),
    );
  });
});
