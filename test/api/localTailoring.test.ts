import { beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ session: vi.fn(), create: vi.fn(), latest: vi.fn(), submit: vi.fn(), cancel: vi.fn(), progress: vi.fn(), fail: vi.fn() }));
vi.mock("@/lib/server/auth/requireSession", () => ({ requireSession: calls.session, requireSessionWithEmail: calls.session, UnauthorizedError: class UnauthorizedError extends Error {} }));
vi.mock("@/lib/server/api/aiRateLimit", () => ({ enforceAiRateLimit: vi.fn(() => null) }));
vi.mock("@/lib/server/observability/errorReporter", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/server/localTailoring/tasks", () => ({
  createLocalTask: calls.create, latestLocalTask: calls.latest, cancelLocalTask: calls.cancel, progressLocalTask: calls.progress, failLocalTask: calls.fail,
  taskError: (code: string, message: string, status: number) => Object.assign(new Error(message), { code, status }),
}));
vi.mock("@/lib/server/localTailoring/results", () => ({ submitLocalResult: calls.submit }));
import { POST as create, GET as latest } from "@/app/api/local-tailoring/tasks/route";
import { POST as submit } from "@/app/api/local-tailoring/tasks/[id]/result/route";
import { POST as cancel } from "@/app/api/local-tailoring/tasks/[id]/cancel/route";
import { POST as progress } from "@/app/api/local-tailoring/tasks/[id]/progress/route";

const userId = "10000000-0000-4000-8000-000000000001";
const jobId = "20000000-0000-4000-8000-000000000002";
const id = "30000000-0000-4000-8000-000000000003";
const capability = "x".repeat(43);
const ctx = { params: Promise.resolve({ id }) };
function request(body: unknown, bearer = false) {
  return new Request("https://joblit.tech/api/local-tailoring/tasks", { method: "POST", headers: { "content-type": "application/json", origin: "https://joblit.tech", ...(bearer ? { authorization: `Bearer ${capability}` } : {}) }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.clearAllMocks();
  calls.session.mockResolvedValue({ userId, requestId: "request" });
  calls.create.mockResolvedValue({ taskId: id, capability, prompt: { instructions: "system", input: "input" } });
  calls.latest.mockResolvedValue({ taskId: id, status: "completed", result: { applicationId: "application" } });
  calls.submit.mockResolvedValue({ status: "completed", applicationId: "application" });
  calls.cancel.mockResolvedValue({ taskId: id, status: "cancelled" });
  calls.progress.mockResolvedValue({ taskId: id, status: "generating", attempt: 1 });
});

describe("local tailoring routes", () => {
  it("issues only for the session user and returns a packet with string prompt fields", async () => {
    const response = await create(request({ jobId, target: "resume" }));
    expect(response.status).toBe(200);
    expect(calls.create).toHaveBeenCalledWith(userId, { jobId, target: "resume" });
    expect(await response.json()).toMatchObject({ taskId: id, capability, prompt: { input: "input" } });
  });
  it("rejects user/provider/prompt injection and cross-origin creation", async () => {
    expect((await create(request({ jobId, target: "resume", userId: "other", prompt: "run this" }))).status).toBe(400);
    const crossSite = request({ jobId, target: "resume" });
    crossSite.headers.set("origin", "https://other.example");
    expect((await create(crossSite)).status).toBe(403);
    expect(calls.create).not.toHaveBeenCalled();
  });
  it("restores a durable result through the user's session, without reissuing a capability", async () => {
    const response = await latest(new Request(`https://joblit.tech/api/local-tailoring/tasks?jobId=${jobId}&target=cover`));
    expect(calls.latest).toHaveBeenCalledWith(userId, { jobId, target: "cover" });
    expect(await response.json()).toMatchObject({ task: { result: { applicationId: "application" } } });
    expect(calls.create).not.toHaveBeenCalled();
  });
  it("a result requires its task capability even when a session exists", async () => {
    expect((await submit(request({ rawOutput: "json", attempt: 1 }), ctx)).status).toBe(401);
    expect(calls.session).not.toHaveBeenCalled(); expect(calls.submit).not.toHaveBeenCalled();
    const response = await submit(request({ rawOutput: "json", attempt: 1 }, true), ctx);
    expect(response.status).toBe(200);
    expect(calls.submit).toHaveBeenCalledWith(id, { capability }, { rawOutput: "json", attempt: 1 });
  });
  it("uses 202 for an in-flight duplicate and rejects an out-of-bounds attempt", async () => {
    calls.submit.mockResolvedValue({ status: "publishing", attempt: 1, retryAfterSeconds: 3 });
    expect((await submit(request({ rawOutput: "json", attempt: 1 }, true), ctx)).status).toBe(202);
    expect((await submit(request({ rawOutput: "json", attempt: 4 }, true), ctx)).status).toBe(400);
  });
  it("cancellation can use session or the same task capability and returns a task envelope", async () => {
    expect(await (await cancel(request({}), ctx)).json()).toMatchObject({ task: { status: "cancelled" } });
    expect(calls.cancel).toHaveBeenLastCalledWith(id, { userId });
    await cancel(request({}, true), ctx);
    expect(calls.cancel).toHaveBeenLastCalledWith(id, { capability });
  });
  it("does not let a progress request set a completed or arbitrary status", async () => {
    expect((await progress(request({ phase: "completed", attempt: 1 }, true), ctx)).status).toBe(400);
    expect(calls.progress).not.toHaveBeenCalled();
    expect((await progress(request({ phase: "generating", attempt: 1 }, true), ctx)).status).toBe(200);
  });
});
