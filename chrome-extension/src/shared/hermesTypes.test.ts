import { describe, expect, it } from "vitest";
import {
  BRIDGE_CHANNEL,
  BRIDGE_VERSION,
  parseBridgeRequest,
  validatePublicRunResult,
} from "./hermesTypes";

const now = 1_750_000_000_000;
const requestId = "550e8400-e29b-41d4-a716-446655440000";
const jobId = "c56a4180-65aa-42ec-a945-5fd21dec0538";

function request(overrides: Record<string, unknown> = {}) {
  return {
    channel: BRIDGE_CHANNEL,
    direction: "web-to-extension",
    version: BRIDGE_VERSION,
    messageId: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
    nonce: "nonce_0123456789abcdef",
    issuedAt: now - 100,
    expiresAt: now + 10_000,
    action: "START_RUN",
    payload: { requestId, jobId, target: "resume" },
    ...overrides,
  };
}

describe("parseBridgeRequest", () => {
  it("accepts the strict start envelope", () => {
    expect(parseBridgeRequest(request(), now)).toEqual(request());
  });

  it("accepts a strict presence ping", () => {
    const ping = request({ action: "PING", payload: {} });
    expect(parseBridgeRequest(ping, now)).toEqual(ping);
  });

  it.each([
    ["channel", "other"],
    ["direction", "extension-to-web"],
    ["version", 2],
    ["messageId", "not-a-uuid"],
    ["nonce", "short"],
    ["expiresAt", now - 1],
    ["expiresAt", now + 31_000],
    ["action", "FETCH_URL"],
  ])("rejects invalid %s", (key, value) => {
    expect(parseBridgeRequest(request({ [key]: value }), now)).toBeNull();
  });

  it("rejects extra envelope and payload fields", () => {
    expect(parseBridgeRequest({ ...request(), token: "secret" }, now)).toBeNull();
    expect(
      parseBridgeRequest(
        request({ payload: { requestId, jobId, target: "resume", prompt: "no" } }),
        now,
      ),
    ).toBeNull();
  });
});

describe("validatePublicRunResult", () => {
  it("accepts a bounded successful terminal result", () => {
    expect(
      validatePublicRunResult({
        requestId,
        jobId,
        target: "cover",
        status: "succeeded",
        modelOutput: JSON.stringify({ cover: "A".repeat(30) }),
        promptMeta: { promptHash: "sha256:test" },
      }),
    ).toBe(true);
  });

  it("rejects run ids, short output, and oversized output", () => {
    expect(validatePublicRunResult({ requestId, status: "running", run_id: "run_secret" })).toBe(false);
    expect(
      validatePublicRunResult({ requestId, jobId, target: "resume", status: "succeeded", modelOutput: "{}", promptMeta: {} }),
    ).toBe(false);
    expect(
      validatePublicRunResult({ requestId, jobId, target: "resume", status: "succeeded", modelOutput: "x".repeat(80_001), promptMeta: {} }),
    ).toBe(false);
  });
});
