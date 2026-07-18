import {
  BRIDGE_CHANNEL,
  BRIDGE_VERSION,
  JOBLIT_WEB_ORIGIN,
  MAX_BRIDGE_RESPONSE_BYTES,
  isPublicLocalAiError,
  jsonByteLength,
  parseBridgeRequest,
  validatePublicLocalAiStatus,
  validatePublicRunResult,
  type BridgeRequest,
  type BridgeResponse,
  type PublicLocalAiError,
  type PublicLocalAiStatus,
  type PublicRunResult,
} from "@ext/shared/hermesTypes";
import type { BackgroundMessage, MessageResponse } from "@ext/shared/types";

const MAX_REQUESTS_PER_MINUTE = 120;
// Generation budget shared by START_RUN and REPAIR_RUN. Batch triage runs a
// generation per ~27s batch, so 4/min throttled legitimate scans; 6/min still
// bounds abuse while letting a multi-batch scan proceed.
const MAX_STARTS_PER_MINUTE = 6;
const MAX_STATUS_REQUESTS_PER_MINUTE = 20;
const REPLAY_CACHE_LIMIT = 256;

interface BridgeDependencies {
  now?: () => number;
  post?: (message: BridgeResponse, targetOrigin: string) => void;
  send?: (
    message: BackgroundMessage,
    callback: (response: MessageResponse) => void,
  ) => void;
}

function publicError(
  code: PublicLocalAiError["code"],
  message: string,
  retryable = false,
): PublicLocalAiError {
  return { code, message, retryable };
}

type BackgroundBridgeRequest = Exclude<BridgeRequest, { action: "PING" }>;

function internalMessage(request: BackgroundBridgeRequest): BackgroundMessage {
  switch (request.action) {
    case "GET_STATUS":
      return { type: "LOCAL_AI_GET_STATUS" };
    case "START_RUN":
      return { type: "LOCAL_AI_START_RUN", payload: request.payload };
    case "GET_RUN":
      return { type: "LOCAL_AI_GET_RUN", payload: request.payload };
    case "STOP_RUN":
      return { type: "LOCAL_AI_STOP_RUN", payload: request.payload };
    case "REPAIR_RUN":
      return { type: "LOCAL_AI_REPAIR_RUN", payload: request.payload };
  }
  throw new Error("Unsupported Local AI bridge action");
}

function responseBase(request: BridgeRequest) {
  return {
    channel: BRIDGE_CHANNEL,
    direction: "extension-to-web" as const,
    version: BRIDGE_VERSION,
    messageId: request.messageId,
    nonce: request.nonce,
  };
}

export function createJoblitBridgeHandler(dependencies: BridgeDependencies = {}) {
  const now = dependencies.now ?? (() => Date.now());
  const post = dependencies.post ?? ((message, targetOrigin) => window.postMessage(message, targetOrigin));
  const send = dependencies.send ?? ((message, callback) => chrome.runtime.sendMessage(message, callback));
  const seen = new Map<string, number>();
  let requestTimes: number[] = [];
  let startTimes: number[] = [];
  let statusTimes: number[] = [];

  function emitError(request: BridgeRequest, error: PublicLocalAiError): void {
    post({ ...responseBase(request), ok: false, error }, JOBLIT_WEB_ORIGIN);
  }

  return (event: MessageEvent): void => {
    if (event.source !== window || event.origin !== JOBLIT_WEB_ORIGIN) return;
    const current = now();
    const request = parseBridgeRequest(event.data, current);
    if (!request) return;

    for (const [messageId, expiresAt] of seen) {
      if (expiresAt <= current) seen.delete(messageId);
    }
    if (seen.has(request.messageId)) return;
    seen.set(request.messageId, request.expiresAt);
    while (seen.size > REPLAY_CACHE_LIMIT) seen.delete(seen.keys().next().value as string);

    const cutoff = current - 60_000;
    requestTimes = requestTimes.filter((time) => time > cutoff);
    startTimes = startTimes.filter((time) => time > cutoff);
    statusTimes = statusTimes.filter((time) => time > cutoff);
    // REPAIR_RUN triggers a model generation just like START_RUN, so it shares
    // the same per-minute generation budget.
    const isGeneration = request.action === "START_RUN" || request.action === "REPAIR_RUN";
    if (
      requestTimes.length >= MAX_REQUESTS_PER_MINUTE ||
      (isGeneration && startTimes.length >= MAX_STARTS_PER_MINUTE) ||
      (request.action === "GET_STATUS" && statusTimes.length >= MAX_STATUS_REQUESTS_PER_MINUTE)
    ) {
      emitError(request, publicError("RATE_LIMITED", "Too many Local AI requests. Wait a moment and try again.", true));
      return;
    }
    requestTimes.push(current);
    if (isGeneration) startTimes.push(current);
    if (request.action === "GET_STATUS") statusTimes.push(current);

    if (request.action === "PING") {
      const bridgeResponse: BridgeResponse = {
        ...responseBase(request),
        ok: true,
        data: { present: true },
      };
      post(bridgeResponse, JOBLIT_WEB_ORIGIN);
      return;
    }

    let settled = false;
    const handleResponse = (response: MessageResponse): void => {
      if (settled) return;
      settled = true;
      if (chrome.runtime.lastError) {
        emitError(request, publicError("HERMES_UNREACHABLE", "The Joblit extension background service is unavailable.", true));
        return;
      }
      if (!response?.success) {
        const candidate = {
          code: response?.errorCode,
          message: response?.error,
          retryable: response?.retryable,
        };
        const error = isPublicLocalAiError(candidate)
          ? candidate
          : publicError("HERMES_PROTOCOL_ERROR", "The Local AI request failed.");
        emitError(request, error);
        return;
      }
      let data: PublicLocalAiStatus | PublicRunResult;
      if (request.action === "GET_STATUS") {
        if (!validatePublicLocalAiStatus(response.data)) {
          emitError(request, publicError("HERMES_PROTOCOL_ERROR", "The Local AI response is invalid."));
          return;
        }
        data = response.data;
      } else {
        if (!validatePublicRunResult(response.data)) {
          emitError(request, publicError("HERMES_PROTOCOL_ERROR", "The Local AI response is invalid."));
          return;
        }
        data = response.data;
      }
      const bridgeResponse: BridgeResponse = { ...responseBase(request), ok: true, data };
      if (jsonByteLength(bridgeResponse) > MAX_BRIDGE_RESPONSE_BYTES) {
        emitError(request, publicError("HERMES_RESPONSE_TOO_LARGE", "The Local AI response is too large."));
        return;
      }
      post(bridgeResponse, JOBLIT_WEB_ORIGIN);
    };
    try {
      send(internalMessage(request), handleResponse);
    } catch {
      if (!settled) {
        settled = true;
        emitError(request, publicError("HERMES_UNREACHABLE", "The Joblit extension background service is unavailable.", true));
      }
    }
  };
}

type JoblitBridgeGlobal = typeof globalThis & { __joblitHermesBridgeInstalled__?: boolean };
const bridgeGlobal = globalThis as JoblitBridgeGlobal;

function installJoblitBridge(): (() => void) | null {
  if (window !== window.top || window.location.origin !== JOBLIT_WEB_ORIGIN) return null;
  if (bridgeGlobal.__joblitHermesBridgeInstalled__) return null;
  bridgeGlobal.__joblitHermesBridgeInstalled__ = true;
  const handler = createJoblitBridgeHandler();
  window.addEventListener("message", handler);
  return () => {
    window.removeEventListener("message", handler);
    delete bridgeGlobal.__joblitHermesBridgeInstalled__;
  };
}

installJoblitBridge();
