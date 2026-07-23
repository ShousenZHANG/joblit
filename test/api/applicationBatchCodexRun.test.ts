import { beforeEach, describe, expect, it, vi } from "vitest";

const runner = vi.hoisted(() => ({
  // Hoisted out of the claim loop: it scans the whole batch, so it is per-run
  // work, not per-claim work.
  reclaimStaleBatchTasks: vi.fn(),
  claimNextBatchTask: vi.fn(),
  getBatchProgress: vi.fn(),
}));

const promptRules = vi.hoisted(() => ({
  getActivePromptSkillRulesForUser: vi.fn(),
}));

const resumeProfile = vi.hoisted(() => ({
  getResumeProfile: vi.fn(),
}));

const applicationBatchStore = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

const jobStore = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock("@/lib/server/applicationBatches/runner", () => runner);
vi.mock("@/lib/server/promptRuleTemplates", () => promptRules);
vi.mock("@/lib/server/resumeProfile", () => resumeProfile);
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    applicationBatch: applicationBatchStore,
    job: jobStore,
  },
}));

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/application-batches/[id]/codex-run/route";

const BATCH_ID = "550e8400-e29b-41d4-a716-446655440000";
const TASK_ID = "660e8400-e29b-41d4-a716-446655440000";
const JOB_ID = "770e8400-e29b-41d4-a716-446655440000";

describe("application batch codex-run api", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    applicationBatchStore.findFirst.mockReset();
    jobStore.findFirst.mockReset();
    runner.claimNextBatchTask.mockReset();
    runner.getBatchProgress.mockReset();
    promptRules.getActivePromptSkillRulesForUser.mockReset();
    resumeProfile.getResumeProfile.mockReset();
  });

  it("claims tasks and returns codex context payload", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    applicationBatchStore.findFirst.mockResolvedValueOnce({
      id: BATCH_ID,
      status: "QUEUED",
      scope: "NEW",
      totalCount: 3,
      error: null,
    });
    resumeProfile.getResumeProfile.mockResolvedValueOnce({
      id: "profile-1",
      updatedAt: new Date("2026-02-22T10:00:00.000Z"),
      summary: "Summary",
      experiences: [{ title: "Software Engineer", bullets: ["one"] }],
      skills: [{ category: "Frontend", items: ["React"] }],
    });
    promptRules.getActivePromptSkillRulesForUser.mockResolvedValueOnce({
      id: "rules-1",
      locale: "en-AU",
      cvRules: ["cv-1"],
      coverRules: ["cover-1"],
      hardConstraints: ["hard-1"],
    });
    runner.claimNextBatchTask
      .mockResolvedValueOnce({
        kind: "claimed",
        task: {
          id: TASK_ID,
          jobId: JOB_ID,
          title: "Software Engineer",
          company: "Acme",
          jobUrl: "https://example.com/jobs/1",
        },
      })
      .mockResolvedValueOnce({
        kind: "done",
        batchStatus: "RUNNING",
        progress: {
          pending: 2,
          running: 0,
          succeeded: 1,
          failed: 0,
          skipped: 0,
        },
      });
    jobStore.findFirst.mockResolvedValueOnce({
      id: JOB_ID,
      title: "Software Engineer",
      company: "Acme",
      jobUrl: "https://example.com/jobs/1",
      status: "NEW",
      description: "Job description",
      updatedAt: new Date("2026-02-22T09:59:00.000Z"),
    });
    runner.getBatchProgress.mockResolvedValueOnce({
      pending: 2,
      running: 0,
      succeeded: 1,
      failed: 0,
      skipped: 0,
    });

    const res = await POST(
      new Request(`http://localhost/api/application-batches/${BATCH_ID}/codex-run`, {
        method: "POST",
        body: JSON.stringify({ maxSteps: 2 }),
      }),
      { params: Promise.resolve({ id: BATCH_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.batch.id).toBe(BATCH_ID);
    expect(json.tasks).toHaveLength(1);
    expect(json.tasks[0].taskId).toBe(TASK_ID);
    expect(json.tasks[0].job.id).toBe(JOB_ID);
    expect(json.context.promptMeta.ruleSetId).toBe("rules-1");
    expect(json.context.promptMeta.resumeSnapshotUpdatedAt).toBe("2026-02-22T10:00:00.000Z");
    expect(typeof json.context.promptMeta.promptTemplateVersion).toBe("string");
    expect(typeof json.context.promptMeta.schemaVersion).toBe("string");
    expect(typeof json.context.promptMeta.promptHash).toBe("string");
    expect(json.context.promptMetaByTarget.resume.ruleSetId).toBe("rules-1");
    expect(json.context.promptMetaByTarget.cover.ruleSetId).toBe("rules-1");
    expect(typeof json.context.resumeSnapshotHash).toBe("string");
    expect(json.context.resumeSnapshotHash.length).toBe(64);
    expect(json.execution.stopReason).toBe("BATCH_COMPLETE");
  });
});
