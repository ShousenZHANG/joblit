import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendMessage } from "./messaging";

describe("sendMessage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends message via chrome.runtime and resolves with response", async () => {
    const mockResponse = { success: true, data: { name: "test" } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(chrome.runtime, "sendMessage").mockImplementation(
      ((...args: unknown[]) => {
        const callback = args[args.length - 1] as (response: unknown) => void;
        callback(mockResponse);
      }) as typeof chrome.runtime.sendMessage,
    );

    const result = await sendMessage({ type: "GET_AUTH_STATUS" });
    expect(result).toEqual(mockResponse);
  });

  it("returns error response when chrome.runtime.lastError is set", async () => {
    vi.spyOn(chrome.runtime, "sendMessage").mockImplementation(
      ((...args: unknown[]) => {
        const callback = args[args.length - 1] as (response: unknown) => void;
        Object.defineProperty(chrome.runtime, "lastError", {
          value: { message: "Extension context invalidated" },
          configurable: true,
        });
        callback(undefined);
        Object.defineProperty(chrome.runtime, "lastError", {
          value: undefined,
          configurable: true,
        });
      }) as typeof chrome.runtime.sendMessage,
    );

    const result = await sendMessage({ type: "GET_AUTH_STATUS" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Extension context invalidated");
  });
});
