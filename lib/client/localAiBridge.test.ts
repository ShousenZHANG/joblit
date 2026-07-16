import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendLocalAiBridgeRequest } from "./localAiBridge";
import { LOCAL_AI_BRIDGE_CHANNEL } from "@/lib/shared/localAiBridgeContract";

describe("local AI bridge client", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("posts only the allowlisted envelope to the exact page origin", async () => {
    const post = vi.spyOn(window, "postMessage").mockImplementation((message) => {
      const request = message as Record<string, unknown>;
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: window.location.origin,
            source: window,
            data: {
              channel: LOCAL_AI_BRIDGE_CHANNEL,
              direction: "extension-to-web",
              version: 1,
              messageId: request.messageId,
              nonce: request.nonce,
              ok: true,
              data: { state: "ready", joblitConnected: true, profileName: "joblit" },
            },
          }),
        );
      });
    });

    await expect(sendLocalAiBridgeRequest("GET_STATUS", {})).resolves.toEqual({
      state: "ready",
      joblitConnected: true,
      profileName: "joblit",
    });
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: LOCAL_AI_BRIDGE_CHANNEL,
        direction: "web-to-extension",
        version: 1,
        action: "GET_STATUS",
        expiresAt: expect.any(Number),
      }),
      window.location.origin,
    );
    expect(JSON.stringify(post.mock.calls[0][0])).not.toMatch(/token|prompt|run_id|https?:\/\//i);
  });

  it("ignores wrong origin/source/id/nonce and rejects on bounded timeout", async () => {
    vi.spyOn(window, "postMessage").mockImplementation((message) => {
      const request = message as Record<string, unknown>;
      window.dispatchEvent(new MessageEvent("message", {
        origin: "https://attacker.example",
        data: { messageId: request.messageId, nonce: request.nonce },
      }));
    });
    const promise = sendLocalAiBridgeRequest("GET_STATUS", {}, { timeoutMs: 500 });
    const rejection = expect(promise).rejects.toMatchObject({ code: "BRIDGE_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(500);
    await rejection;
  });

  it("cleans up immediately when aborted", async () => {
    vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    const controller = new AbortController();
    const promise = sendLocalAiBridgeRequest("GET_STATUS", {}, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: "BRIDGE_ABORTED" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
