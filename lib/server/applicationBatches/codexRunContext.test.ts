import { beforeEach, describe, expect, it, vi } from "vitest";

const runner = vi.hoisted(() => ({
  // Hoisted out of the claim loop: it scans the whole batch, so it is per-run
  // work, not per-claim work.
  reclaimStaleBatchTasks: vi.fn(),
  BatchRunnerError: class BatchRunnerError extends Error {
    code: "NOT_FOUND" | "INVALID_STATE";

    constructor(code: "NOT_FOUND" | "INVALID_STATE", message: string) {
      super(message);
      this.code = code;
    }
  },
  claimNextBatchTask: vi.fn(),
  completeBatchTask: vi.fn(),
}));

const promptRules = vi.hoisted(() => ({
  getActivePromptSkillRulesForUser: vi.fn(),
}));

const jobStore = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock("@/lib/server/applicationBatches/runner", () => runner);
vi.mock("@/lib/server/promptRuleTemplates", () => promptRules);
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    job: jobStore,
  },
}));

import {
  buildBatchRunContext,
  buildResumeSnapshotHash,
  claimBatchRunTasks,
  completeBatchRunTasks,
  deriveBatchStatusFromRun,
} from "./codexRunContext";

describe("codex run context", () => {
  beforeEach(() => {
    runner.claimNextBatchTask.mockReset();
    runner.completeBatchTask.mockReset();
    promptRules.getActivePromptSkillRulesForUser.mockReset();
    jobStore.findFirst.mockReset();
  });

  it("builds stable resume snapshot hash from profile payload", () => {
    const profile = {
      summary: "Summary",
      basics: { name: "Jane" },
      links: [],
      skills: [{ label: "Backend", items: ["Java"] }],
      experiences: [{ title: "Engineer", bullets: ["Built APIs"] }],
      projects: [],
      education: [],
      updatedAt: new Date("2026-02-22T10:00:00.000Z"),
    };

    expect(buildResumeSnapshotHash(profile)).toBe(buildResumeSnapshotHash({ ...profile }));
    expect(buildResumeSnapshotHash(profile)).toHaveLength(64);
  });

  it("builds prompt context for both import targets", async () => {
    promptRules.getActivePromptSkillRulesForUser.mockResolvedValueOnce({
      id: "rules-1",
      locale: "en-AU",
      cvRules: ["cv-1"],
      coverRules: ["cover-1"],
      hardConstraints: ["json-only"],
    });

    const context = await buildBatchRunContext({
      userId: "user-1",
      profile: {
        updatedAt: new Date("2026-02-22T10:00:00.000Z"),
      },
    });

    expect(context.promptMeta.ruleSetId).toBe("rules-1");
    expect(context.promptMetaByTarget.resume.promptHash).not.toBe(
      context.promptMetaByTarget.cover.promptHash,
    );
    expect(context.rules).toEqual({
      locale: "en-AU",
      cvRules: ["cv-1"],
      coverRules: ["cover-1"],
      hardConstraints: ["json-only"],
    });
  });

  it("claims visible job payloads and stops when the batch completes", async () => {
    runner.claimNextBatchTask
      .mockResolvedValueOnce({
        kind: "claimed",
        task: {
          id: "task-1",
          jobId: "job-1",
          title: "Software Engineer",
          company: "Acme",
          jobUrl: "https://example.com/1",
        },
      })
      .mockResolvedValueOnce({
        kind: "done",
        batchStatus: "RUNNING",
        progress: {
          pending: 0,
          running: 0,
          succeeded: 1,
          failed: 0,
          skipped: 0,
        },
      });
    jobStore.findFirst.mockResolvedValueOnce({
      id: "job-1",
      title: "Software Engineer",
      company: "Acme",
      jobUrl: "https://example.com/1",
      status: "NEW",
      description: "Build APIs",
      updatedAt: new Date("2026-02-22T09:00:00.000Z"),
    });

    const result = await claimBatchRunTasks({
      userId: "user-1",
      batchId: "batch-1",
      batchStatus: "RUNNING",
      maxSteps: 2,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.tasks).toEqual([
      {
        taskId: "task-1",
        jobId: "job-1",
        job: {
          id: "job-1",
          title: "Software Engineer",
          company: "Acme",
          jobUrl: "https://example.com/1",
          status: "NEW",
          description: "Build APIs",
          updatedAt: "2026-02-22T09:00:00.000Z",
        },
      },
    ]);
    expect(result.stopReason).toBe("BATCH_COMPLETE");
    // The reclaim scans every task in the batch. Running it per claim issued
    // maxSteps full-batch writes when only the first could act on anything.
    expect(runner.reclaimStaleBatchTasks).toHaveBeenCalledTimes(1);
    expect(runner.claimNextBatchTask).toHaveBeenCalledWith(
      expect.objectContaining({ skipStaleReclaim: true }),
    );
  });

  it("dedupes completions and records runner-level rejections", async () => {
    runner.completeBatchTask
      .mockResolvedValueOnce({
        taskStatus: "SUCCEEDED",
        batchStatus: "RUNNING",
        progress: {
          pending: 1,
          running: 0,
          succeeded: 1,
          failed: 0,
          skipped: 0,
        },
      })
      .mockRejectedValueOnce(new runner.BatchRunnerError("INVALID_STATE", "Task is not running"));

    const results = await completeBatchRunTasks({
      userId: "user-1",
      batchId: "batch-1",
      completedTasks: [
        { taskId: "task-1", status: "SUCCEEDED" },
        { taskId: "task-1", status: "FAILED", error: "duplicate ignored" },
        { taskId: "task-2", status: "FAILED", error: "compile failed" },
      ],
    });

    expect(runner.completeBatchTask).toHaveBeenCalledTimes(2);
    expect(results).toEqual([
      { taskId: "task-1", status: "SUCCEEDED", accepted: true },
      { taskId: "task-2", status: "FAILED", accepted: false, error: "INVALID_STATE" },
    ]);
  });

  it("derives the response batch status from terminal, progress, and claim results", () => {
    expect(
      deriveBatchStatusFromRun({
        initialBatchStatus: "RUNNING",
        progress: { pending: 0, running: 0, succeeded: 0, failed: 0, skipped: 0 },
        claimedCount: 0,
        stopReason: "BATCH_TERMINAL",
        claimedDoneStatus: null,
        terminalStatus: "CANCELLED",
      }),
    ).toBe("CANCELLED");

    expect(
      deriveBatchStatusFromRun({
        initialBatchStatus: "QUEUED",
        progress: { pending: 0, running: 0, succeeded: 2, failed: 0, skipped: 0 },
        claimedCount: 0,
        stopReason: "BATCH_COMPLETE",
        claimedDoneStatus: null,
        terminalStatus: null,
      }),
    ).toBe("SUCCEEDED");

    expect(
      deriveBatchStatusFromRun({
        initialBatchStatus: "QUEUED",
        progress: { pending: 0, running: 0, succeeded: 0, failed: 0, skipped: 0 },
        claimedCount: 1,
        stopReason: "LIMIT_REACHED",
        claimedDoneStatus: null,
        terminalStatus: null,
      }),
    ).toBe("RUNNING");
  });
});
