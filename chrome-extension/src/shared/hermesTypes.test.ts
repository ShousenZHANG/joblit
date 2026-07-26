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
const tailoringRun = {
  id: "8f8f8f8f-8f8f-4f8f-8f8f-8f8f8f8f8f8f",
  attemptId: "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a",
};

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

  it("accepts a triage batch payload and enforces its shape", () => {
    const jobIds = [jobId, requestId];
    expect(
      parseBridgeRequest(request({ payload: { requestId, jobId, target: "triage", jobIds } }), now),
    ).not.toBeNull();
    // jobIds[0] must equal jobId.
    expect(
      parseBridgeRequest(
        request({ payload: { requestId, jobId, target: "triage", jobIds: [requestId, jobId] } }),
        now,
      ),
    ).toBeNull();
    // A non-triage target must not carry jobIds.
    expect(
      parseBridgeRequest(
        request({ payload: { requestId, jobId, target: "resume", jobIds } }),
        now,
      ),
    ).toBeNull();
    // triage without jobIds is invalid.
    expect(
      parseBridgeRequest(request({ payload: { requestId, jobId, target: "triage" } }), now),
    ).toBeNull();
  });
});

describe("validatePublicRunResult", () => {
  it("accepts a bounded successful terminal result with a TailoringRun handle", () => {
    expect(
      validatePublicRunResult({
        requestId,
        jobId,
        target: "cover",
        status: "succeeded",
        modelOutput: JSON.stringify({ cover: "A".repeat(30) }),
        promptMeta: { promptHash: "sha256:test" },
        tailoringRun,
      }),
    ).toBe(true);
  });

  it("keeps legacy handle-less results readable but rejects malformed handles", () => {
    expect(
      validatePublicRunResult({
        requestId,
        jobId,
        target: "resume",
        status: "succeeded",
        modelOutput: JSON.stringify({ cvSummary: "A".repeat(30) }),
        promptMeta: { promptHash: "sha256:test" },
      }),
    ).toBe(true);
    expect(
      validatePublicRunResult({
        requestId,
        jobId,
        target: "resume",
        status: "running",
        tailoringRun: { ...tailoringRun, attemptId: "not-a-uuid" },
      }),
    ).toBe(false);
  });

  it("rejects private run/session ids, short output, and oversized output", () => {
    expect(validatePublicRunResult({ requestId, status: "running", run_id: "run_secret" })).toBe(false);
    expect(
      validatePublicRunResult({
        requestId,
        jobId,
        target: "resume",
        status: "running",
        sessionId: "private-session",
      }),
    ).toBe(false);
    expect(
      validatePublicRunResult({
        requestId,
        jobId,
        target: "resume",
        status: "running",
        session_id: "private-session",
      }),
    ).toBe(false);
    expect(
      validatePublicRunResult({ requestId, jobId, target: "resume", status: "succeeded", modelOutput: "{}", promptMeta: {} }),
    ).toBe(false);
    expect(
      validatePublicRunResult({ requestId, jobId, target: "resume", status: "succeeded", modelOutput: "x".repeat(80_001), promptMeta: {} }),
    ).toBe(false);
  });
});
