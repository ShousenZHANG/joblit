import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  detectLocalAiAvailability,
  sendLocalAiBridgeRequest,
} from "./localAiBridge";
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

  it("keeps the extension detected when Hermes status takes longer than 1.5 seconds", async () => {
    const actions: string[] = [];
    vi.spyOn(window, "postMessage").mockImplementation((message) => {
      const request = message as Record<string, unknown>;
      actions.push(String(request.action));
      const respond = (data: unknown) => {
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
              data,
            },
          }),
        );
      };
      if (request.action === "PING") {
        queueMicrotask(() => respond({ present: true }));
      } else if (request.action === "GET_STATUS") {
        window.setTimeout(
          () => respond({ state: "ready", joblitConnected: true, profileName: "joblit" }),
          2_136,
        );
      }
    });

    const detection = detectLocalAiAvailability();
    await vi.runAllTimersAsync();

    await expect(detection).resolves.toBe("ready");
    expect(actions).toEqual(["PING", "GET_STATUS"]);
  });

  it("falls back to GET_STATUS for installed legacy extensions without PING", async () => {
    const actions: string[] = [];
    vi.spyOn(window, "postMessage").mockImplementation((message) => {
      const request = message as Record<string, unknown>;
      actions.push(String(request.action));
      if (request.action !== "GET_STATUS") return;
      window.setTimeout(() => {
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
      }, 2_136);
    });

    const detection = detectLocalAiAvailability();
    await vi.runAllTimersAsync();

    await expect(detection).resolves.toBe("ready");
    expect(actions).toEqual(["PING", "GET_STATUS"]);
  });

  it("distinguishes a missing extension from a slow or failed Hermes probe", async () => {
    const post = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    const missing = detectLocalAiAvailability();
    await vi.runAllTimersAsync();
    await expect(missing).resolves.toBe("extension_missing");

    post.mockImplementation((message) => {
      const request = message as Record<string, unknown>;
      if (request.action !== "PING") return;
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
              data: { present: true },
            },
          }),
        );
      });
    });
    const bridgeError = detectLocalAiAvailability();
    await vi.runAllTimersAsync();
    await expect(bridgeError).resolves.toBe("bridge_error");
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
