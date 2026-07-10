import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendToActiveTab } from "./tabBridge";

describe("sendToActiveTab", () => {
  const tabId = 42;
  let query: ReturnType<typeof vi.fn>;
  let sendMessage: ReturnType<typeof vi.fn>;
  let getManifest: ReturnType<typeof vi.fn>;
  let executeScript: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    query = vi.fn().mockResolvedValue([{ id: tabId }]);
    sendMessage = vi.fn();
    getManifest = vi.fn().mockReturnValue({
      content_scripts: [{ js: ["assets/content-loader.js"] }],
    });
    executeScript = vi.fn().mockResolvedValue([]);

    Object.assign(chrome.tabs, { query, sendMessage });
    Object.assign(chrome.runtime, { getManifest });
    Object.assign(chrome, { scripting: { executeScript } });
  });

  it("forwards directly when the content script responds to ping", async () => {
    const fillResponse = { success: true, filled: 2, skipped: 1 };
    sendMessage
      .mockResolvedValueOnce({ type: "JOBLIT_PONG" })
      .mockResolvedValueOnce(fillResponse);

    await expect(
      sendToActiveTab<typeof fillResponse>({ type: "TRIGGER_FILL" }),
    ).resolves.toEqual(fillResponse);

    expect(sendMessage).toHaveBeenNthCalledWith(1, tabId, {
      type: "JOBLIT_PING",
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, tabId, {
      type: "TRIGGER_FILL",
    });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("injects the first built loader only when ping has no receiver", async () => {
    const fillResponse = { success: true, filled: 1, skipped: 0 };
    sendMessage
      .mockRejectedValueOnce(
        new Error(
          "Could not establish connection. Receiving end does not exist.",
        ),
      )
      .mockResolvedValueOnce(fillResponse);

    await expect(
      sendToActiveTab<typeof fillResponse>({ type: "TRIGGER_FILL" }),
    ).resolves.toEqual(fillResponse);

    expect(executeScript).toHaveBeenCalledOnce();
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId },
      files: ["assets/content-loader.js"],
    });
    expect(sendMessage).toHaveBeenLastCalledWith(tabId, {
      type: "TRIGGER_FILL",
    });
  });

  it("retries a missing receiver while the injected loader finishes", async () => {
    const fillResponse = { success: true, filled: 1, skipped: 0 };
    const missingReceiver = new Error(
      "Could not establish connection. Receiving end does not exist.",
    );
    sendMessage
      .mockRejectedValueOnce(missingReceiver)
      .mockRejectedValueOnce(missingReceiver)
      .mockResolvedValueOnce(fillResponse);

    await expect(
      sendToActiveTab<typeof fillResponse>({ type: "TRIGGER_FILL" }),
    ).resolves.toEqual(fillResponse);

    expect(executeScript).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });

  it("does not inject when ping fails for another reason", async () => {
    sendMessage.mockRejectedValueOnce(
      new Error("Cannot access contents of the page"),
    );

    await expect(
      sendToActiveTab({ type: "TOGGLE_WIDGET" }),
    ).rejects.toThrow("Cannot access contents of the page");
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("throws a clear error when there is no active tab", async () => {
    query.mockResolvedValueOnce([]);

    await expect(
      sendToActiveTab({ type: "TRIGGER_FILL" }),
    ).rejects.toThrow("No active tab");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("throws a clear error when the built loader is missing", async () => {
    sendMessage.mockRejectedValueOnce(
      new Error("Could not establish connection. Receiving end does not exist."),
    );
    getManifest.mockReturnValueOnce({ content_scripts: [] });

    await expect(
      sendToActiveTab({ type: "TRIGGER_FILL" }),
    ).rejects.toThrow("Content script loader is missing");
    expect(executeScript).not.toHaveBeenCalled();
  });
});
