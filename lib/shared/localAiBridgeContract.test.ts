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
