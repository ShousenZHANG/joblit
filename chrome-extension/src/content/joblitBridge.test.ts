import { describe, expect, it, vi } from "vitest";
import { BRIDGE_CHANNEL, JOBLIT_WEB_ORIGIN } from "@ext/shared/hermesTypes";
import { createJoblitBridgeHandler } from "./joblitBridge";

const now = 1_750_000_000_000;
const baseRequest = {
  channel: BRIDGE_CHANNEL,
  direction: "web-to-extension",
  version: 1,
  messageId: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
  nonce: "nonce_0123456789abcdef",
  issuedAt: now - 100,
  expiresAt: now + 10_000,
  action: "GET_STATUS",
  payload: {},
} as const;

function event(data: unknown, origin: string = JOBLIT_WEB_ORIGIN, source: Window | null = window) {
  return new MessageEvent("message", { data, origin, source });
}

describe("Joblit document bridge", () => {
  it("answers a presence ping immediately without waking the background worker", () => {
    const post = vi.fn();
    const send = vi.fn();
    const handler = createJoblitBridgeHandler({ now: () => now, post, send });

    handler(event({ ...baseRequest, action: "PING" }));

    expect(send).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: baseRequest.messageId,
        nonce: baseRequest.nonce,
        ok: true,
        data: { present: true },
      }),
      JOBLIT_WEB_ORIGIN,
    );
  });

  it("forwards only a valid exact-origin request and returns matching correlation fields", async () => {
    const post = vi.fn();
    const send = vi.fn((_message, callback) => callback({
      success: true,
      data: { state: "ready", joblitConnected: true, profileName: "joblit-0123456789abcdef" },
    }));
    const handler = createJoblitBridgeHandler({ now: () => now, post, send });

    handler(event(baseRequest));
    await Promise.resolve();

    expect(send).toHaveBeenCalledWith({ type: "LOCAL_AI_GET_STATUS" }, expect.any(Function));
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: BRIDGE_CHANNEL,
        direction: "extension-to-web",
        messageId: baseRequest.messageId,
        nonce: baseRequest.nonce,
        ok: true,
      }),
      JOBLIT_WEB_ORIGIN,
    );
  });

  it("ignores wrong origins, wrong window sources, and replayed messages", () => {
    const post = vi.fn();
    const send = vi.fn();
    const handler = createJoblitBridgeHandler({ now: () => now, post, send });
    handler(event(baseRequest, "https://evil.example"));
    handler(event(baseRequest, JOBLIT_WEB_ORIGIN, null));
    handler(event(baseRequest));
    handler(event(baseRequest));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("never forwards prompt, token, endpoint, or run id fields", () => {
    const send = vi.fn();
    const handler = createJoblitBridgeHandler({ now: () => now, post: vi.fn(), send });
    handler(event({ ...baseRequest, payload: { prompt: "secret" } }));
    handler(event({ ...baseRequest, messageId: "4c1a6f60-9e13-4bb3-a45f-2d7f7f51f111", action: "SAVE_SETTINGS", payload: { token: "secret" } }));
    expect(send).not.toHaveBeenCalled();
  });
});
