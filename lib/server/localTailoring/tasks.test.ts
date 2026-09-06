import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const effects = vi.hoisted(() => ({
  prisma: {} as Record<string, unknown>,
  sources: vi.fn(), prompt: vi.fn(), artifact: vi.fn(), compile: vi.fn(), ats: vi.fn(), commit: vi.fn(),
}));
vi.mock("@/lib/server/prisma", () => ({ prisma: effects.prisma }));
vi.mock("@/lib/server/applications/applicationMutationLock", () => ({ acquireApplicationMutationLock: vi.fn() }));
vi.mock("./sources", () => ({ readLockedTaskSources: effects.sources, assertTaskSources: effects.sources }));
vi.mock("@/lib/server/applications/applicationPrompt", () => ({ buildApplicationPromptForUser: effects.prompt }));
vi.mock("@/lib/server/applications/manualImportArtifact", () => ({ buildManualImportArtifact: effects.artifact }));
vi.mock("@/lib/server/latex/mapResumeProfile", () => ({ mapResumeProfile: vi.fn(() => ({})) }));
vi.mock("@/lib/server/latex/compilePdf", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/server/latex/compilePdf")>(), compileLatexToPdf: effects.compile }));
vi.mock("@/lib/server/applications/atsPdfValidator", () => ({ assertAtsPdf: effects.ats }));
vi.mock("@/lib/server/applications/finalizeApplication", () => ({ buildAtsKeywords: vi.fn(() => []) }));
vi.mock("@/lib/server/applications/applicationPublication", () => ({ buildApplicationPublicationRenderContext: vi.fn(() => ({ available: true })) }));
vi.mock("@/lib/server/applications/commitApplicationArtifact", () => ({ commitApplicationArtifact: effects.commit }));
vi.mock("@/lib/server/observability/errorReporter", () => ({ reportError: vi.fn() }));

import { AppError } from "@/lib/server/api/appError";
import { LatexRenderError } from "@/lib/server/latex/compilePdf";
import { digest, issueTaskCapability } from "./capability";
import { applicationTargetHash } from "./applicationTarget";
import { createLocalTask, cancelLocalTask, latestLocalTask, progressLocalTask, failLocalTask, authorisedTask } from "./tasks";
import { submitLocalResult } from "./results";

// The in-memory Prisma boundary accepts heterogeneous models and query shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
let tasks: Map<string, Row>;
let attempts: Map<string, Row>;
let application: Row | null;
let writes: number;
let tx: Row;
let transaction: <T>(fn: (tx: Row) => Promise<T>) => Promise<T>;
let task: Row;
let access: { capability: string };
const userId = "10000000-0000-4000-8000-000000000001";
const jobId = "20000000-0000-4000-8000-000000000002";
const clone = <T,>(value: T): T => structuredClone(value);
const key = (where: Row) => `${where.taskId_attempt.taskId}:${where.taskId_attempt.attempt}`;
const apply = (row: Row, data: Row) => {
  for (const [name, value] of Object.entries(data)) row[name] = value?.constructor?.name === "DbNull" ? null : clone(value);
  return clone(row);
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_SECRET", "test-only-local-capability-secret");
  tasks = new Map(); attempts = new Map(); application = null; writes = 0;
  const profileUpdatedAt = new Date("2026-09-01T00:00:00Z");
  task = {
    id: "30000000-0000-4000-8000-000000000003", userId, jobId, target: "resume", status: "pending", attempt: 0,
    expiresAt: new Date(Date.now() + 7_200_000), createdAt: new Date(), updatedAt: new Date(),
    resumeProfileId: "40000000-0000-4000-8000-000000000004", locale: "en-AU", promptHash: "prompt",
    resumeSnapshotHash: "resume", jobSnapshotHash: "job", rulesHash: "rules", profileUpdatedAt,
    expectedTargetHash: applicationTargetHash(null, "resume"), result: null, error: null,
  };
  access = { capability: issueTaskCapability(task as Parameters<typeof issueTaskCapability>[0]) };
  task.capabilityHash = digest(access.capability);
  tasks.set(task.id, task);
  tx = {
    localTailoringTask: {
      findUnique: vi.fn(async ({ where }) => clone(tasks.get(where.id) ?? null)),
      findFirst: vi.fn(async ({ where }) => clone([...tasks.values()].reverse().find(row => row.userId === where.userId && row.jobId === where.jobId && row.target === where.target && (!where.status || where.status.in.includes(row.status))) ?? null)),
      create: vi.fn(async ({ data }) => { const row = { status: "pending", attempt: 0, result: null, error: null, createdAt: new Date(), updatedAt: new Date(), ...data }; tasks.set(row.id, row); return clone(row); }),
      update: vi.fn(async ({ where, data }) => apply(tasks.get(where.id)!, data)),
    },
    localTailoringAttempt: {
      findUnique: vi.fn(async ({ where }) => clone(attempts.get(key(where)) ?? null)),
      upsert: vi.fn(async ({ where, create, update }) => { const k = key(where); const old = attempts.get(k); if (old) return apply(old, update); attempts.set(k, { response: null, ...clone(create) }); return clone(attempts.get(k)); }),
      update: vi.fn(async ({ where, data }) => apply(attempts.get(key(where))!, data)),
    },
    application: { findUnique: vi.fn(async () => clone(application)) },
  };
  let queue: Promise<unknown> = Promise.resolve();
  transaction = (fn) => {
    const pending = queue.then(async () => {
      const before = { tasks: clone(tasks), attempts: clone(attempts), application: clone(application), writes };
      try { return await fn(tx); } catch (error) {
        tasks = before.tasks; attempts = before.attempts; application = before.application; writes = before.writes;
        throw error;
      }
    });
    queue = pending.catch(() => undefined);
    return pending;
  };
  Object.assign(effects.prisma, tx, { $transaction: transaction });
  effects.sources.mockResolvedValue({
    profile: { id: task.resumeProfileId, updatedAt: profileUpdatedAt }, job: { id: jobId, title: "Engineer", company: "Acme", userId, market: "AU" }, locale: "en-AU", prompt: { instructions: "system", input: "input" },
    binding: { promptHash: "prompt", resumeSnapshotHash: "resume", jobSnapshotHash: "job", rulesHash: "rules", profileUpdatedAt },
  });
  effects.prompt.mockResolvedValue({ snapshotBinding: { resumeProfileId: task.resumeProfileId }, promptMeta: { promptHash: "prompt" } });
  effects.artifact.mockReturnValue({ ok: true, tex: "tex", filename: "resume.pdf", aiContent: {} });
  effects.compile.mockResolvedValue(Buffer.from("pdf"));
  effects.ats.mockResolvedValue({ passed: true });
  effects.commit.mockImplementation(async (input) => transaction(async (client) => {
    await input.receipt.assertCurrent(client);
    const committed = { kind: "committed", applicationId: "application", aiContentHash: "accepted-hash", publication: { status: "FINAL" }, urls: { resume: "https://blob.example/resume.pdf" } };
    application = { ...application, id: "application", aiContent: { ...application?.aiContent, [input.mergeTarget === "resume" ? "cv" : "cover"]: { summary: "accepted" } }, aiContentHash: "accepted-hash", updatedAt: new Date() }; writes++;
    await input.receipt.record(client, committed);
    return committed;
  }));
});
afterEach(() => vi.unstubAllEnvs());

describe("local task lifecycle", () => {
  it("reuses an active task with stable authorization across concurrent browser starts", async () => {
    const [first, second] = await Promise.all([createLocalTask(userId, { jobId, target: "resume" }), createLocalTask(userId, { jobId, target: "resume" })]);
    expect(first.taskId).toBe(task.id); expect(second.capability).toBe(access.capability);
    expect(tx.localTailoringTask.create).not.toHaveBeenCalled();
    expect(first.prompt).toEqual({ instructions: "system", input: "input" });
    expect(JSON.stringify(await latestLocalTask(userId, { jobId, target: "resume" }))).not.toContain(access.capability);
  });
  it("rejects another user, wrong token, and expired capability before any write", async () => {
    await expect(authorisedTask(task.id, { userId: "other" })).rejects.toMatchObject({ code: "LOCAL_TASK_NOT_FOUND" });
    await expect(submitLocalResult(task.id, { capability: "x".repeat(43) }, { rawOutput: "output", attempt: 1 })).rejects.toMatchObject({ code: "LOCAL_TASK_NOT_FOUND" });
    task.expiresAt = new Date(Date.now() - 1);
    await expect(submitLocalResult(task.id, access, { rawOutput: "output", attempt: 1 })).rejects.toMatchObject({ code: "LOCAL_TASK_EXPIRED" });
    expect(effects.compile).not.toHaveBeenCalled(); expect(writes).toBe(0);
  });
  it("replays a completed receipt without rendering or overwriting subsequent user edits", async () => {
    const result = await submitLocalResult(task.id, access, { rawOutput: "output", attempt: 1 });
    application = { id: "application", aiContent: { cv: { summary: "user edit" } }, aiContentHash: "user-edited", updatedAt: new Date() };
    const replay = await submitLocalResult(task.id, access, { rawOutput: "output", attempt: 1 });
    expect(replay).toEqual(result); expect(writes).toBe(1); expect(effects.compile).toHaveBeenCalledTimes(1);
    expect(application.aiContentHash).toBe("user-edited");
    expect((await latestLocalTask(userId, { jobId, target: "resume" }))?.result).toMatchObject({ applicationId: "application", status: "completed" });
  });
  it("rejects conflicting output under an already received attempt", async () => {
    await submitLocalResult(task.id, access, { rawOutput: "output", attempt: 1 });
    await expect(submitLocalResult(task.id, access, { rawOutput: "different", attempt: 1 })).rejects.toMatchObject({ code: "LOCAL_TASK_RESULT_CONFLICT" });
    expect(writes).toBe(1);
  });
  it("returns publishing to a concurrent duplicate while the first response renders", async () => {
    let finish!: (buffer: Buffer) => void;
    effects.compile.mockReturnValue(new Promise<Buffer>(resolve => { finish = resolve; }));
    const first = submitLocalResult(task.id, access, { rawOutput: "output", attempt: 1 });
    await vi.waitFor(() => expect(effects.compile).toHaveBeenCalled());
    expect(await submitLocalResult(task.id, access, { rawOutput: "output", attempt: 1 })).toMatchObject({ status: "publishing" });
    finish(Buffer.from("pdf")); await first;
    expect(writes).toBe(1);
  });
  it("a cancellation during PDF rendering fences the final write", async () => {
    let finish!: (buffer: Buffer) => void;
    effects.compile.mockReturnValue(new Promise<Buffer>(resolve => { finish = resolve; }));
    const pending = submitLocalResult(task.id, access, { rawOutput: "output", attempt: 1 });
    await vi.waitFor(() => expect(effects.compile).toHaveBeenCalled());
    await cancelLocalTask(task.id, { userId });
    finish(Buffer.from("pdf"));
    await expect(pending).rejects.toMatchObject({ code: "LOCAL_TASK_NOT_ACTIVE" });
    expect(writes).toBe(0); expect(tasks.get(task.id)?.status).toBe("cancelled");
  });
  it("cancel after atomic publication reports completed and keeps its receipt", async () => {
    await submitLocalResult(task.id, access, { rawOutput: "output", attempt: 1 });
    expect(await cancelLocalTask(task.id, { userId })).toMatchObject({ status: "completed" });
    expect(await failLocalTask(task.id, access)).toMatchObject({ status: "completed" });
  });
  it("preserves edits and source changes that occur while rendering", async () => {
    effects.compile.mockImplementation(async () => { application = { id: "user-draft", aiContent: { cv: { summary: "user edit" } }, aiContentHash: "edited", updatedAt: new Date() }; return Buffer.from("pdf"); });
    await expect(submitLocalResult(task.id, access, { rawOutput: "output", attempt: 1 })).rejects.toMatchObject({ code: "LOCAL_TASK_APPLICATION_CHANGED" });
    expect(writes).toBe(0); expect(tasks.get(task.id)?.status).toBe("failed");
  });
  it("fences a changed profile or job again at final commit", async () => {
    effects.sources.mockResolvedValueOnce(await effects.sources()).mockRejectedValueOnce(new AppError({ code: "LOCAL_TASK_SOURCE_CHANGED", status: 409, publicMessage: "Source changed" }));
    await expect(submitLocalResult(task.id, access, { rawOutput: "output", attempt: 1 })).rejects.toMatchObject({ code: "LOCAL_TASK_SOURCE_CHANGED" });
    expect(writes).toBe(0);
  });
  it("retries an interrupted publication using the same result, not a new model attempt", async () => {
    effects.compile.mockRejectedValueOnce(new Error("network interrupted"));
    await expect(submitLocalResult(task.id, access, { rawOutput: "output", attempt: 1 })).rejects.toThrow("network interrupted");
    expect(await submitLocalResult(task.id, access, { rawOutput: "output", attempt: 1 })).toMatchObject({ status: "completed" });
    expect(writes).toBe(1); expect(attempts.size).toBe(1);
  });
  it("settles a rejected render without depending on a second companion request", async () => {
    effects.compile.mockRejectedValueOnce(new LatexRenderError("LATEX_RENDER_FAILED", 422, "LATEX_RENDER_FAILED_422", { upstream: "private renderer response" }));
    await expect(submitLocalResult(task.id, access, { rawOutput: "output", attempt: 1 })).rejects.toMatchObject({ code: "LATEX_RENDER_FAILED", status: 422 });
    expect((await latestLocalTask(userId, { jobId, target: "resume" }))).toMatchObject({ status: "failed", error: { code: "LATEX_RENDER_FAILED", message: "LATEX_RENDER_FAILED_422", status: 422 } });
    expect(JSON.stringify(tasks.get(task.id)?.error)).not.toContain("private");
    await expect(submitLocalResult(task.id, access, { rawOutput: "output", attempt: 1 })).rejects.toMatchObject({ code: "LOCAL_TASK_NOT_ACTIVE" });
    expect(effects.compile).toHaveBeenCalledTimes(1); expect(writes).toBe(0);
  });
  it("preserves a safe renderer outage reason while allowing the identical result to resume", async () => {
    effects.compile.mockRejectedValueOnce(new LatexRenderError("LATEX_RENDER_CONFIG_MISSING", 503, "No render service configuration", { upstream: "private configuration" }));
    await expect(submitLocalResult(task.id, access, { rawOutput: "output", attempt: 1 })).rejects.toMatchObject({ code: "LATEX_RENDER_CONFIG_MISSING", status: 503 });
    expect(tasks.get(task.id)).toMatchObject({ status: "publishing", error: { code: "LATEX_RENDER_CONFIG_MISSING", message: "No render service configuration", status: 503 } });
    expect(JSON.stringify(tasks.get(task.id)?.error)).not.toContain("private");
    expect(await submitLocalResult(task.id, access, { rawOutput: "output", attempt: 1 })).toMatchObject({ status: "completed" });
    expect(effects.artifact).toHaveBeenCalledWith(expect.objectContaining({ source: "local_ai" }));
    expect(writes).toBe(1); expect(attempts.size).toBe(1);
  });
  it("stops after a deterministic ATS rejection without recompiling the same response", async () => {
    effects.ats.mockRejectedValueOnce(new AppError({ code: "ATS_PDF_VALIDATION_FAILED", status: 422, publicMessage: "PDF failed readability validation." }));
    await expect(submitLocalResult(task.id, access, { rawOutput: "output", attempt: 1 })).rejects.toMatchObject({ code: "ATS_PDF_VALIDATION_FAILED" });
    expect(tasks.get(task.id)).toMatchObject({ status: "failed", error: { code: "ATS_PDF_VALIDATION_FAILED", status: 422 } });
    await expect(submitLocalResult(task.id, access, { rawOutput: "output", attempt: 1 })).rejects.toMatchObject({ code: "LOCAL_TASK_NOT_ACTIVE" });
    expect(effects.compile).toHaveBeenCalledTimes(1); expect(effects.ats).toHaveBeenCalledTimes(1); expect(writes).toBe(0);
  });
  it("stores repair verdicts, prevents skipped attempts, and stops on a repeated rejection", async () => {
    effects.artifact.mockReturnValue({ ok: false, error: { code: "SUMMARY_LENGTH", message: "Shorten the summary." } });
    const first = await submitLocalResult(task.id, access, { rawOutput: "bad1", attempt: 1 });
    expect(first).toMatchObject({ status: "repair", code: "SUMMARY_LENGTH" });
    expect(await submitLocalResult(task.id, access, { rawOutput: "bad1", attempt: 1 })).toEqual(first);
    await expect(submitLocalResult(task.id, access, { rawOutput: "bad3", attempt: 3 })).rejects.toMatchObject({ code: "LOCAL_TASK_ATTEMPT_CONFLICT" });
    await progressLocalTask(task.id, access, 2);
    const failed = await submitLocalResult(task.id, access, { rawOutput: "bad2", attempt: 2 });
    expect(failed).toMatchObject({ status: "failed", code: "SUMMARY_LENGTH" });
    expect(await submitLocalResult(task.id, access, { rawOutput: "bad2", attempt: 2 })).toEqual(failed);
    expect(effects.compile).not.toHaveBeenCalled();
  });
  it("reclaims an expired publishing lease only for the identical output", async () => {
    attempts.set(`${task.id}:1`, { taskId: task.id, attempt: 1, outputHash: digest("output"), claimId: "old", claimExpiresAt: new Date(Date.now() - 1000), response: null });
    task.status = "publishing"; task.attempt = 1;
    expect(await submitLocalResult(task.id, access, { rawOutput: "output", attempt: 1 })).toMatchObject({ status: "completed" });
    expect(writes).toBe(1);
  });
  it("allows the other document to create or change the Application while rendering", async () => {
    effects.compile.mockImplementation(async () => {
      application = { id: "other-target-created", aiContent: { cover: { paragraphOne: "edited cover" } }, coverPdfUrl: "https://blob.example/cover.pdf", coverPublishedHash: "cover-final", aiContentHash: "cover-hash", updatedAt: new Date() };
      return Buffer.from("pdf");
    });
    expect(await submitLocalResult(task.id, access, { rawOutput: "output", attempt: 1 })).toMatchObject({ status: "completed" });
    expect(application?.aiContent.cover).toEqual({ paragraphOne: "edited cover" });
    expect(writes).toBe(1);
  });
  it("recovers the atomic success receipt when the commit response was lost", async () => {
    const commit = effects.commit.getMockImplementation()!;
    effects.commit.mockImplementationOnce(async input => { await commit(input); throw new Error("commit response lost"); });
    expect(await submitLocalResult(task.id, access, { rawOutput: "output", attempt: 1 })).toMatchObject({ status: "completed" });
    expect(writes).toBe(1);
  });
  it("stops after three distinct deterministic rejections", async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      effects.artifact.mockReturnValue({ ok: false, error: { code: `RULE_${attempt}`, message: "Correct this rule." } });
      expect(await submitLocalResult(task.id, access, { rawOutput: `bad${attempt}`, attempt })).toMatchObject({ status: attempt === 3 ? "failed" : "repair", attempt });
    }
    expect(effects.compile).not.toHaveBeenCalled();
  });
});
