import { z } from "zod";

export const COMPANION_ORIGIN = "http://127.0.0.1:8791";
const targetSchema = z.enum(["resume", "cover"]);
const errorSchema = z.object({ code: z.string(), message: z.string() });
const resultSchema = z.object({
  applicationId: z.string(),
  aiContentHash: z.string().nullable().optional(),
  resumePdfUrl: z.string().nullable().optional(),
  resumePdfName: z.string().nullable().optional(),
  coverPdfUrl: z.string().nullable().optional(),
  coverPdfName: z.string().nullable().optional(),
});
const taskSchema = z.object({
  taskId: z.string().min(1), jobId: z.string().min(1), target: targetSchema,
  status: z.enum(["pending", "queued", "generating", "running", "repair", "repairing", "publishing", "cancelling", "completed", "failed", "cancelled", "expired"]),
  attempt: z.number().int().nonnegative().optional().default(0),
  maxAttempts: z.number().int().positive().optional().default(3),
  error: errorSchema.nullable().optional(),
  result: resultSchema.nullable().optional(),
});
export type CompanionTask = Omit<z.infer<typeof taskSchema>, "status"> & {
  status: "queued" | "generating" | "repairing" | "publishing" | "cancelling" | "completed" | "failed" | "cancelled" | "expired";
};
const authSchema = z.object({
  state: z.enum(["ready", "required", "authenticating", "unavailable"]),
  loginUrl: z.string().optional(), userCode: z.string().optional(), message: z.string().optional(),
});
export const companionStatusSchema = z.object({
  protocolVersion: z.literal(1),
  runtime: z.object({ state: z.enum(["ready", "unavailable"]) }),
  auth: authSchema,
});
export type CompanionStatus = z.infer<typeof companionStatusSchema>;
export const pairingSchema = z.object({ token: z.string().min(1), account: z.string(), protocolVersion: z.literal(1) });
export const authResponseSchema = z.object({ auth: authSchema });
export const taskPacketSchema = z.object({
  taskId: z.string(), capability: z.string().min(1), expiresAt: z.string(),
  prompt: z.object({ instructions: z.string(), input: z.string() }),
});

export class CompanionError extends Error {
  constructor(public readonly code: "network" | "timeout" | "permission" | "protocol" | "http" | "aborted", message: string, public readonly status?: number) {
    super(message);
    this.name = "CompanionError";
  }
}

export function parseTask(value: unknown): CompanionTask | null {
  if (value === null) return null;
  const parsed = taskSchema.safeParse(value);
  if (!parsed.success) throw new CompanionError("protocol", "The task response is not compatible with this version of Joblit.");
  const task = parsed.data;
  if (task.status === "completed" && (!task.result || !(task.target === "resume" ? task.result.resumePdfUrl : task.result.coverPdfUrl))) {
    throw new CompanionError("protocol", "A completed task must include its published PDF receipt.");
  }
  const aliases = { pending: "queued", running: "generating", repair: "repairing" } as const;
  const status = task.status in aliases ? aliases[task.status as keyof typeof aliases] : task.status;
  return { ...task, status: status as CompanionTask["status"] };
}

export function isTaskRunning(task: CompanionTask | null): boolean {
  return !!task && ["queued", "generating", "repairing", "publishing", "cancelling"].includes(task.status);
}

/** A failed browser fetch is ambiguous: a closed app, CORS, or local-network permission. */
export async function companionRequest(path: string, options: { token?: string; body?: unknown; signal?: AbortSignal; local?: boolean; timeoutMs?: number } = {}): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 6000);
  try {
    const response = await fetch(`${options.local === false ? "" : COMPANION_ORIGIN}${path}`, {
      method: options.body === undefined ? "GET" : "POST",
      credentials: options.local === false ? "same-origin" : "omit",
      cache: "no-store",
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = z.object({ error: errorSchema }).safeParse(payload);
      throw new CompanionError(response.status === 401 || response.status === 403 ? "permission" : "http", parsed.success ? parsed.data.error.message : `Request failed (${response.status}).`, response.status);
    }
    return payload;
  } catch (error) {
    if (error instanceof CompanionError) throw error;
    if (controller.signal.aborted) throw new CompanionError(timedOut ? "timeout" : "aborted", timedOut ? "The companion did not respond in time." : "Request stopped.");
    throw new CompanionError("network", "Could not reach the companion. It may be closed, or browser access to local apps may be blocked.");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function unwrapTask(payload: unknown): CompanionTask | null {
  if (typeof payload !== "object" || payload === null || !("task" in payload)) throw new CompanionError("protocol", "Missing task response.");
  return parseTask(payload.task);
}

export async function accountFingerprint(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newChallenge(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function launchCompanion(account: string, challenge: string): void {
  const link = document.createElement("a");
  link.href = `joblit://connect?${new URLSearchParams({ origin: location.origin, challenge, account })}`;
  link.click();
}

export function pairingToken(account: string, value?: string | null): string | null {
  const key = `joblit.companion.v1:${location.origin}:${account}`;
  try {
    if (value === null) localStorage.removeItem(key);
    else if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch { return value ?? null; }
}
