import { describe, expect, it } from "vitest";

import {
  LOCAL_AI_BRIDGE_CHANNEL,
  LOCAL_AI_BRIDGE_MAX_RESPONSE_BYTES,
  LOCAL_AI_BRIDGE_TTL_MS,
  parseBridgeRequest,
  parseBridgeResponse,
} from "./localAiBridgeContract";

const ID = "550e8400-e29b-41d4-a716-446655440000";
const NONCE = "22222222-2222-4222-8222-222222222222";
const TAILORING_RUN = {
  id: "8f8f8f8f-8f8f-4f8f-8f8f-8f8f8f8f8f8f",
  attemptId: "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a",
};
const NOW = 1_800_000_000_000;

function request(overrides: Record<string, unknown> = {}) {
  return {
    channel: LOCAL_AI_BRIDGE_CHANNEL,
    direction: "web-to-extension",
    version: 1,
    messageId: ID,
    nonce: NONCE,
    issuedAt: NOW,
    expiresAt: NOW + LOCAL_AI_BRIDGE_TTL_MS,
    action: "START_RUN",
    payload: { requestId: ID, jobId: NONCE, target: "resume" },
    ...overrides,
  };
}

describe("local AI bridge contract", () => {
  it("accepts an exact, bounded request", () => {
    expect(parseBridgeRequest(request(), NOW)?.action).toBe("START_RUN");
  });

  it("accepts the match target for fit-scan runs", () => {
    const match = request({ payload: { requestId: ID, jobId: NONCE, target: "match" } });
    expect(parseBridgeRequest(match, NOW)?.action).toBe("START_RUN");
  });

  it("accepts a bounded triage batch and rejects malformed jobIds", () => {
    const jobIds = [NONCE, ID];
    const ok = request({ payload: { requestId: ID, jobId: NONCE, target: "triage", jobIds } });
    expect(parseBridgeRequest(ok, NOW)?.action).toBe("START_RUN");

    // jobIds[0] must equal jobId.
    expect(
      parseBridgeRequest(
        request({ payload: { requestId: ID, jobId: NONCE, target: "triage", jobIds: [ID, NONCE] } }),
        NOW,
      ),
    ).toBeNull();
    // Duplicate ids rejected.
    expect(
      parseBridgeRequest(
        request({ payload: { requestId: ID, jobId: NONCE, target: "triage", jobIds: [NONCE, NONCE] } }),
        NOW,
      ),
    ).toBeNull();
    // Over the 15-job cap rejected.
    expect(
      parseBridgeRequest(
        request({ payload: { requestId: ID, jobId: NONCE, target: "triage", jobIds: Array(16).fill(NONCE) } }),
        NOW,
      ),
    ).toBeNull();
  });

  it("accepts a bounded repair request and rejects unsafe feedback", () => {
    const repair = request({
      action: "REPAIR_RUN",
      payload: { requestId: ID, feedback: "cvSummary exceeds the 2000 character limit" },
    });
    expect(parseBridgeRequest(repair, NOW)?.action).toBe("REPAIR_RUN");

    expect(
      parseBridgeRequest(
        request({ action: "REPAIR_RUN", payload: { requestId: ID, feedback: "bad\u0000byte" } }),
        NOW,
      ),
    ).toBeNull();
    expect(
      parseBridgeRequest(
        request({ action: "REPAIR_RUN", payload: { requestId: ID, feedback: "x".repeat(1_500) } }),
        NOW,
      ),
    ).toBeNull();
    expect(
      parseBridgeRequest(
        request({ action: "REPAIR_RUN", payload: { requestId: ID, feedback: "ok", extra: "no" } }),
        NOW,
      ),
    ).toBeNull();
  });

  it("accepts optional bounded progress on a running run response", () => {
    const base = {
      channel: LOCAL_AI_BRIDGE_CHANNEL,
      direction: "extension-to-web",
      version: 1,
      messageId: ID,
      nonce: NONCE,
      ok: true,
    };
    const run = { requestId: ID, jobId: NONCE, target: "resume", status: "running" };
    expect(
      parseBridgeResponse({ ...base, data: { ...run, progressChars: 512 } }),
    ).toMatchObject({ ok: true, data: { progressChars: 512 } });
    expect(parseBridgeResponse({ ...base, data: { ...run, progressChars: -1 } })).toBeNull();
    expect(
      parseBridgeResponse({ ...base, data: { ...run, status: "queued", progressChars: 5 } }),
    ).toBeNull();
  });

  it("accepts a strict optional TailoringRun handle on public run states", () => {
    const base = {
      channel: LOCAL_AI_BRIDGE_CHANNEL,
      direction: "extension-to-web",
      version: 1,
      messageId: ID,
      nonce: NONCE,
      ok: true,
    };
    const active = {
      requestId: ID,
      jobId: NONCE,
      target: "resume",
      status: "running",
      tailoringRun: TAILORING_RUN,
    };

    expect(parseBridgeResponse({ ...base, data: active })).toMatchObject({
      ok: true,
      data: { tailoringRun: TAILORING_RUN },
    });
    expect(
      parseBridgeResponse({
        ...base,
        data: {
          ...active,
          status: "succeeded",
          modelOutput: JSON.stringify({ cvSummary: "A".repeat(30) }),
          promptMeta: { promptHash: "sha256:test" },
        },
      }),
    ).toMatchObject({
      ok: true,
      data: { status: "succeeded", tailoringRun: TAILORING_RUN },
    });
    expect(
      parseBridgeResponse({
        ...base,
        data: {
          ...active,
          tailoringRun: { ...TAILORING_RUN, attemptId: "not-a-uuid" },
        },
      }),
    ).toBeNull();
  });

  it("keeps legacy handle-less run results readable and rejects private identifiers", () => {
    const base = {
      channel: LOCAL_AI_BRIDGE_CHANNEL,
      direction: "extension-to-web",
      version: 1,
      messageId: ID,
      nonce: NONCE,
      ok: true,
    };
    const succeeded = {
      requestId: ID,
      jobId: NONCE,
      target: "resume",
      status: "succeeded",
      modelOutput: JSON.stringify({ cvSummary: "A".repeat(30) }),
      promptMeta: { promptHash: "sha256:test" },
    };

    expect(parseBridgeResponse({ ...base, data: succeeded })).toMatchObject({
      ok: true,
      data: { status: "succeeded" },
    });
    expect(
      parseBridgeResponse({
        ...base,
        data: { ...succeeded, runId: "run_private" },
      }),
    ).toBeNull();
    expect(
      parseBridgeResponse({
        ...base,
        data: { ...succeeded, sessionId: "private-session" },
      }),
    ).toBeNull();
  });

  it("accepts a strict presence ping and response", () => {
    const ping = request({ action: "PING", payload: {} });
    expect(parseBridgeRequest(ping, NOW)?.action).toBe("PING");
    expect(
      parseBridgeResponse({
        channel: LOCAL_AI_BRIDGE_CHANNEL,
        direction: "extension-to-web",
        version: 1,
        messageId: ID,
        nonce: NONCE,
        ok: true,
        data: { present: true },
      }),
    ).toMatchObject({ ok: true, data: { present: true } });
  });

  it.each([
    ["channel", "other"],
    ["direction", "extension-to-web"],
    ["version", 2],
    ["messageId", "not-a-uuid"],
    ["nonce", "not-a-uuid"],
    ["action", "OPEN_URL"],
  ])("rejects wrong %s", (field, value) => {
    expect(parseBridgeRequest(request({ [field]: value }), NOW)).toBeNull();
  });

  it("rejects expired, future, and over-30-second lifetimes", () => {
    expect(parseBridgeRequest(request({ expiresAt: NOW - 1 }), NOW)).toBeNull();
    expect(parseBridgeRequest(request({ issuedAt: NOW + 6_000, expiresAt: NOW + 10_000 }), NOW)).toBeNull();
    expect(parseBridgeRequest(request({ expiresAt: NOW + LOCAL_AI_BRIDGE_TTL_MS + 1 }), NOW)).toBeNull();
  });

  it("rejects extra fields and sensitive caller-controlled payload fields", () => {
    expect(parseBridgeRequest(request({ token: "secret" }), NOW)).toBeNull();
    expect(
      parseBridgeRequest(
        request({ payload: { requestId: ID, jobId: NONCE, target: "resume", prompt: "secret" } }),
        NOW,
      ),
    ).toBeNull();
  });

  it("rejects malformed run status and oversized model output", () => {
    const base = {
      channel: LOCAL_AI_BRIDGE_CHANNEL,
      direction: "extension-to-web",
      version: 1,
      messageId: ID,
      nonce: NONCE,
      ok: true,
    };
    expect(parseBridgeResponse({ ...base, data: { requestId: ID, jobId: NONCE, target: "resume", status: "done" } })).toBeNull();
    expect(
      parseBridgeResponse(
        {
          ...base,
          data: {
            requestId: ID,
            jobId: NONCE,
            target: "resume",
            status: "succeeded",
            modelOutput: "x".repeat(LOCAL_AI_BRIDGE_MAX_RESPONSE_BYTES),
            promptMeta: {},
          },
        },
      ),
    ).toBeNull();
  });
});
