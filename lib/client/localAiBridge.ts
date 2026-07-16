import {
  LOCAL_AI_BRIDGE_CHANNEL,
  LOCAL_AI_BRIDGE_TTL_MS,
  LOCAL_AI_BRIDGE_VERSION,
  LocalAiAvailabilitySchema,
  LocalAiPublicRunSchema,
  parseBridgeRequest,
  parseBridgeResponse,
  type BridgeAction,
  type LocalAiAvailabilityResult,
  type LocalAiBridgeErrorPayload,
  type LocalAiPublicRun,
  type StartPayload,
} from "@/lib/shared/localAiBridgeContract";

type PayloadByAction = {
  GET_STATUS: Record<string, never>;
  START_RUN: StartPayload;
  GET_RUN: { requestId: string };
  STOP_RUN: { requestId: string };
};

type ResultByAction = {
  GET_STATUS: LocalAiAvailabilityResult;
  START_RUN: LocalAiPublicRun;
  GET_RUN: LocalAiPublicRun;
  STOP_RUN: LocalAiPublicRun;
};

export class LocalAiBridgeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LocalAiBridgeError";
  }
}

function bridgeError(error: LocalAiBridgeErrorPayload): LocalAiBridgeError {
  return new LocalAiBridgeError(error.code, error.message, error.retryable);
}

export function sendLocalAiBridgeRequest<A extends BridgeAction>(
  action: A,
  payload: PayloadByAction[A],
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ResultByAction[A]> {
  if (typeof window === "undefined") {
    return Promise.reject(new LocalAiBridgeError("BRIDGE_UNAVAILABLE", "Browser bridge unavailable", true));
  }

  const messageId = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const issuedAt = Date.now();
  const request = parseBridgeRequest({
    channel: LOCAL_AI_BRIDGE_CHANNEL,
    direction: "web-to-extension",
    version: LOCAL_AI_BRIDGE_VERSION,
    messageId,
    nonce,
    issuedAt,
    expiresAt: issuedAt + LOCAL_AI_BRIDGE_TTL_MS,
    action,
    payload,
  }, issuedAt);
  if (!request) {
    return Promise.reject(
      new LocalAiBridgeError("BRIDGE_INVALID_REQUEST", "Invalid bridge request", false),
    );
  }
  const origin = window.location.origin;
  const timeoutMs = Math.max(250, Math.min(options.timeoutMs ?? 3_000, 10_000));

  return new Promise<ResultByAction[A]>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      options.signal?.removeEventListener("abort", onAbort);
      window.clearTimeout(timeoutId);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () =>
      finish(() => reject(new LocalAiBridgeError("BRIDGE_ABORTED", "Request cancelled", true)));
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== window) return;
      const response = parseBridgeResponse(event.data);
      if (!response || response.messageId !== messageId || response.nonce !== nonce) return;
      if (!response.ok) {
        finish(() => reject(bridgeError(response.error)));
        return;
      }

      const result =
        action === "GET_STATUS"
          ? LocalAiAvailabilitySchema.safeParse(response.data)
          : LocalAiPublicRunSchema.safeParse(response.data);
      if (!result.success) {
        finish(() =>
          reject(new LocalAiBridgeError("BRIDGE_PROTOCOL_ERROR", "Invalid extension response", false)),
        );
        return;
      }
      finish(() => resolve(result.data as ResultByAction[A]));
    };
    const timeoutId = window.setTimeout(() => {
      finish(() => reject(new LocalAiBridgeError("BRIDGE_TIMEOUT", "Extension did not respond", true)));
    }, timeoutMs);

    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    window.addEventListener("message", onMessage);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    window.postMessage(request, origin);
  });
}
