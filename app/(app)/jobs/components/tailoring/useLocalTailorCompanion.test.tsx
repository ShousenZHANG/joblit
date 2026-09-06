import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pairingToken } from "@/lib/client/localTailoring/companionClient";
import { useLocalTailorCompanion } from "./useLocalTailorCompanion";

const mocks = vi.hoisted(() => ({ userId: "first-user", launch: vi.fn() }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: mocks.userId } } }) }));
vi.mock("@/lib/client/localTailoring/companionClient", async (original) => ({
  ...await original<typeof import("@/lib/client/localTailoring/companionClient")>(),
  accountFingerprint: async (id: string) => id === "first-user" ? "a".repeat(64) : "b".repeat(64),
  launchCompanion: mocks.launch,
}));
const ready = { protocolVersion: 1, runtime: { state: "ready" }, auth: { state: "ready" } };
const baseTask = { taskId: "task-1", jobId: "job-1", target: "resume", status: "generating", attempt: 1, maxAttempts: 3 };
const packet = { taskId: "task-1", capability: "scoped-secret", expiresAt: "2026-09-06T10:00:00Z", prompt: { instructions: "instruction", input: "input" } };
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }
function setupRoutes() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.endsWith("/pair")) return json({ protocolVersion: 1, account: "a".repeat(64), token: "paired" });
    if (url.endsWith("/status")) return json(ready);
    if (url === "/api/local-tailoring/tasks" && init?.method === "POST") return json(packet);
    if (url === "http://127.0.0.1:8791/tasks" && init?.method === "POST") return json({ task: baseTask });
    if (url.startsWith("/api/local-tailoring/tasks?")) return json({ task: null });
    if (url.includes("/tasks?")) return json({ tasks: [] });
    if (url.endsWith("/cancel")) return json({ task: { ...baseTask, status: "cancelled" } });
    throw new Error(`Unexpected URL: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
async function connectedHook() {
  pairingToken("a".repeat(64), "paired");
  const hook = renderHook(() => useLocalTailorCompanion({ jobId: "job-1", target: "resume" }));
  await waitFor(() => expect(hook.result.current.connection).toBe("ready"));
  await waitFor(() => expect(hook.result.current.restoring).toBe(false));
  return hook;
}

describe("local tailoring companion lifecycle", () => {
  beforeEach(() => { localStorage.clear(); mocks.userId = "first-user"; mocks.launch.mockReset(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("launches and pairs without generating; only Generate sends the scoped task packet", async () => {
    const fetchMock = setupRoutes();
    const { result } = renderHook(() => useLocalTailorCompanion({ jobId: "job-1", target: "resume" }));
    await waitFor(() => expect(result.current.canConnect).toBe(true));
    await act(async () => { await result.current.connect(); });
    await waitFor(() => expect(result.current.connection).toBe("ready"));
    expect(mocks.launch).toHaveBeenCalledWith("a".repeat(64), expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(fetchMock.mock.calls.some(([url, init]) => url.endsWith("/tasks") && init?.method === "POST")).toBe(false);
    await act(async () => { await result.current.generate(); });
    const taskPost = fetchMock.mock.calls.find(([url]) => url === "http://127.0.0.1:8791/tasks");
    expect(JSON.parse(String(taskPost?.[1]?.body))).toEqual({ ...packet, jobId: "job-1", target: "resume", apiOrigin: location.origin });
    expect(result.current.task?.status).toBe("generating");
    expect(Object.values(localStorage).join(" ")).not.toContain("scoped-secret");
  });

  it("recovers a completed PDF from the server even with no companion connection", async () => {
    const resultReceipt = { applicationId: "application-1", resumePdfUrl: "https://example.com/cv.pdf" };
    const fetchMock = vi.fn(async () => json({ task: { ...baseTask, status: "completed", result: resultReceipt } }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useLocalTailorCompanion({ jobId: "job-1", target: "resume" }));
    await waitFor(() => expect(result.current.task?.result).toEqual(resultReceipt));
    expect(result.current.connection).toBe("disconnected");
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it("does not cancel a running task when the dialog unmounts", async () => {
    const fetchMock = setupRoutes();
    const { result, unmount } = await connectedHook();
    await act(async () => { await result.current.generate(); });
    unmount();
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/cancel"))).toBe(false);
  });

  it("cancels explicitly through both the companion and the durable task service", async () => {
    const fetchMock = setupRoutes();
    const { result } = await connectedHook();
    await act(async () => { await result.current.generate(); });
    await act(async () => { await result.current.cancel(); });
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/cancel")).map(([url]) => url)).toEqual(expect.arrayContaining([
      "http://127.0.0.1:8791/tasks/task-1/cancel", "/api/local-tailoring/tasks/task-1/cancel",
    ]));
  });

  it("keeps an uncertain start pending and never creates a second generation automatically", async () => {
    const base = setupRoutes();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "http://127.0.0.1:8791/tasks") throw new TypeError("Failed to fetch");
      return base(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = await connectedHook();
    await act(async () => { await result.current.generate(); });
    expect(result.current.task?.status).toBe("queued");
    expect(result.current.taskError?.code).toBe("network");
    await act(async () => { await result.current.generate(); });
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/local-tailoring/tasks")).toHaveLength(1);
  });

  it("offers an undelivered saved task for explicit resume using the same task packet", async () => {
    const base = setupRoutes();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/local-tailoring/tasks?")) return json({ task: { ...baseTask, status: "pending" } });
      return base(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = await connectedHook();
    await act(async () => { await result.current.refreshTask(); });
    expect(result.current.dispatchPending).toBe(true);
    expect(result.current.generating).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/local-tailoring/tasks")).toBe(false);
    await act(async () => { await result.current.generate(); });
    expect(result.current.task?.taskId).toBe("task-1");
    expect(result.current.task?.status).toBe("generating");
    expect(result.current.dispatchPending).toBe(false);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/local-tailoring/tasks")).toHaveLength(1);
  });

  it("does not offer resume when the companion already owns the queued task", async () => {
    const base = setupRoutes();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/local-tailoring/tasks?")) return json({ task: { ...baseTask, status: "pending" } });
      if (url.includes("127.0.0.1") && url.includes("/tasks?")) return json({ tasks: [{ ...baseTask, status: "queued" }] });
      return base(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = await connectedHook();
    await act(async () => { await result.current.refreshTask(); });
    expect(result.current.dispatchPending).toBe(false);
    await act(async () => { await result.current.generate(); });
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/local-tailoring/tasks")).toBe(false);
  });

  it("requires recovery before retrying a creation response lost in transit", async () => {
    const base = setupRoutes();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/local-tailoring/tasks") throw new TypeError("Lost response");
      return base(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = await connectedHook();
    await act(async () => { await result.current.generate(); });
    expect(result.current.restoring).toBe(true);
    await act(async () => { await result.current.generate(); });
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/local-tailoring/tasks")).toHaveLength(1);
  });

  it("treats a failed fetch as ambiguous network access, not evidence the app is uninstalled", async () => {
    pairingToken("a".repeat(64), "paired");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("127.0.0.1")) throw new TypeError("Failed to fetch");
      return json({ task: null });
    }));
    const { result } = renderHook(() => useLocalTailorCompanion({ jobId: "job-1", target: "resume" }));
    await waitFor(() => expect(result.current.connection).toBe("error"));
    expect(result.current.connectionError?.code).toBe("network");
  });

  it("ignores late restore responses from a different document", async () => {
    let resolveResume!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("target=resume")
      ? new Promise<Response>((resolve) => { resolveResume = resolve; })
      : Promise.resolve(json({ task: { ...baseTask, target: "cover", taskId: "cover-task" } }))));
    const { result, rerender } = renderHook(({ target }: { target: "resume" | "cover" }) => useLocalTailorCompanion({ jobId: "job-1", target }), { initialProps: { target: "resume" } });
    rerender({ target: "cover" });
    await waitFor(() => expect(result.current.task?.taskId).toBe("cover-task"));
    await act(async () => resolveResume(json({ task: baseTask })));
    expect(result.current.task?.taskId).toBe("cover-task");
  });

  it("does not carry the first account's bearer token into a different signed-in account", async () => {
    const fetchMock = setupRoutes();
    const { result, rerender } = await connectedHook();
    mocks.userId = "second-user";
    rerender();
    await waitFor(() => expect(result.current.connection).toBe("disconnected"));
    await waitFor(() => expect(result.current.canConnect).toBe(true));
    const before = fetchMock.mock.calls.length;
    await act(async () => { await result.current.checkConnection(); });
    expect(fetchMock.mock.calls.length).toBe(before);
    expect(result.current.accountKey).toBe("second-user");
  });
});
