import { INLINE_FETCH_RUN_EXECUTION_LEASE_MS } from "@/lib/shared/fetchRunProtocol";

export interface TriggerFetchRunTarget {
  id: string;
  source: "jobspy" | "nowcoder" | "global";
}

interface TriggerFetchRunOptions {
  fetchImpl?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
  errorMessage?: (response: Response, body: unknown) => string;
  /** Test seam; production observes for one full inline lease plus grace. */
  recoveryObservationMs?: number;
  /** Test seam for the status polling cadence during recovery. */
  recoveryPollIntervalMs?: number;
}

interface TriggerRecoveryContext {
  target: TriggerFetchRunTarget;
  fetchImpl: typeof fetch;
  wait: (milliseconds: number) => Promise<void>;
  errorMessage: (response: Response, body: unknown) => string;
  observationMs: number;
  pollIntervalMs: number;
}

type ExistingExecutionObservation =
  | "succeeded"
  | "failed"
  | "active_or_unknown";

type InitialTriggerResult =
  | { kind: "complete" }
  | { kind: "recover"; initialError: unknown };

class TriggerRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TriggerRequestError";
  }
}

const RECOVERY_GRACE_MS = 5_000;
const RECOVERY_POLL_INTERVAL_MS = 5_000;
const SUCCESS_STATUSES = new Set(["SUCCEEDED", "PARTIAL"]);
const ACTIVE_STATUSES = new Set(["QUEUED", "RUNNING"]);

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createRecoveryContext(
  target: TriggerFetchRunTarget,
  {
    fetchImpl = fetch,
    wait = defaultWait,
    errorMessage = () => "Failed to trigger run",
    recoveryObservationMs =
      INLINE_FETCH_RUN_EXECUTION_LEASE_MS + RECOVERY_GRACE_MS,
    recoveryPollIntervalMs = RECOVERY_POLL_INTERVAL_MS,
  }: TriggerFetchRunOptions,
): TriggerRecoveryContext {
  return {
    target,
    fetchImpl,
    wait,
    errorMessage,
    observationMs: Math.max(0, recoveryObservationMs),
    pollIntervalMs: Math.max(1, recoveryPollIntervalMs),
  };
}

function isRetryableTriggerFailure(error: unknown): boolean {
  if (!(error instanceof TriggerRequestError)) return true;
  return error.status === 408 || error.status === 425 || error.status >= 500;
}

async function readRunStatus(
  context: TriggerRecoveryContext,
): Promise<string | null> {
  const response = await context
    .fetchImpl(`/api/fetch-runs/${context.target.id}`)
    .catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as {
    run?: { status?: unknown };
  } | null;
  return typeof body?.run?.status === "string" ? body.run.status : null;
}

async function postTrigger(
  context: TriggerRecoveryContext,
): Promise<{ alreadyDispatched: boolean }> {
  const response = await context.fetchImpl(
    `/api/fetch-runs/${context.target.id}/trigger`,
    { method: "POST" },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new TriggerRequestError(
      context.errorMessage(response, body),
      response.status,
    );
  }
  return {
    alreadyDispatched: Boolean(
      body &&
        typeof body === "object" &&
        "alreadyDispatched" in body &&
        body.alreadyDispatched,
    ),
  };
}

async function observeExistingExecution(
  context: TriggerRecoveryContext,
): Promise<ExistingExecutionObservation> {
  let elapsed = 0;
  while (true) {
    const status = await readRunStatus(context);
    if (status && SUCCESS_STATUSES.has(status)) return "succeeded";
    if (status && !ACTIVE_STATUSES.has(status)) return "failed";
    if (elapsed >= context.observationMs) return "active_or_unknown";
    const interval = Math.min(
      context.pollIntervalMs,
      context.observationMs - elapsed,
    );
    await context.wait(interval);
    elapsed += interval;
  }
}

async function requestInitialTrigger(
  context: TriggerRecoveryContext,
): Promise<InitialTriggerResult> {
  try {
    const result = await postTrigger(context);
    if (
      context.target.source === "jobspy" ||
      !result.alreadyDispatched
    ) {
      return { kind: "complete" };
    }
    return {
      kind: "recover",
      initialError: new TriggerRequestError(
        "The existing fetch run did not complete",
        409,
      ),
    };
  } catch (error) {
    if (
      context.target.source === "jobspy" ||
      !isRetryableTriggerFailure(error)
    ) {
      throw error;
    }
    return { kind: "recover", initialError: error };
  }
}

async function reconcileRecoveryFailure(
  context: TriggerRecoveryContext,
  retryError: unknown,
): Promise<void> {
  const finalStatus = await readRunStatus(context);
  if (finalStatus && SUCCESS_STATUSES.has(finalStatus)) return;
  if (
    finalStatus &&
    ACTIVE_STATUSES.has(finalStatus) &&
    retryError instanceof TriggerRequestError &&
    retryError.status === 409
  ) {
    return;
  }
  throw retryError;
}

async function retryAfterObservation(
  context: TriggerRecoveryContext,
): Promise<void> {
  try {
    await postTrigger(context);
  } catch (retryError) {
    await reconcileRecoveryFailure(context, retryError);
  }
}

/**
 * Trigger one run and recover a lost in-process invocation exactly once.
 *
 * AU dispatch is never repeated because that would create a duplicate GitHub
 * Actions worker. CN/GLOBAL verify that the original row is still active,
 * observe one execution lease, then retry the same run id.
 */
export async function triggerFetchRunWithRecovery(
  target: TriggerFetchRunTarget,
  options: TriggerFetchRunOptions = {},
): Promise<void> {
  const context = createRecoveryContext(target, options);
  const initial = await requestInitialTrigger(context);
  if (initial.kind === "complete") return;

  const observed = await observeExistingExecution(context);
  if (observed === "succeeded") return;
  if (observed === "failed") throw initial.initialError;
  await retryAfterObservation(context);
}
