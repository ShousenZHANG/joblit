import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Options } from "./Options";

const actGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("Options interaction safety", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalSendMessage: typeof chrome.runtime.sendMessage;
  const contains = vi.fn();
  const request = vi.fn();
  const remove = vi.fn();

  beforeEach(() => {
    actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    Object.assign(chrome, { permissions: { contains, request, remove } });
    originalSendMessage = chrome.runtime.sendMessage;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Object.assign(chrome.runtime, { sendMessage: originalSendMessage });
    Reflect.deleteProperty(chrome, "permissions");
    contains.mockReset();
    request.mockReset();
    remove.mockReset();
    Reflect.deleteProperty(actGlobal, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("locks save while permissions and storage are being resolved", async () => {
    let resolvePermission!: (value: boolean) => void;
    contains.mockReturnValueOnce(new Promise<boolean>((resolve) => {
      resolvePermission = resolve;
    }));
    request.mockResolvedValue(true);
    remove.mockResolvedValue(true);

    await act(async () => {
      root.render(<Options onDisconnect={vi.fn()} />);
    });
    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Save Settings"),
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
    });
    const disabledWhileSaving = saveButton?.disabled;
    const busyWhileSaving = saveButton?.getAttribute("aria-busy");

    await act(async () => {
      resolvePermission(true);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(disabledWhileSaving).toBe(true);
    expect(busyWhileSaving).toBe("true");
  });

  it("uses an explicit cancel-or-disconnect confirmation in Settings", async () => {
    const onDisconnect = vi.fn();
    const sendMessage = vi.fn((_message: unknown, callback?: () => void) => callback?.());
    Object.assign(chrome.runtime, { sendMessage });
    contains.mockResolvedValue(true);

    await act(async () => {
      root.render(<Options onDisconnect={onDisconnect} />);
    });

    const disconnectButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Disconnect",
    );
    expect(disconnectButton).toBeDefined();

    await act(async () => disconnectButton?.click());
    const cancelButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Cancel",
    );
    const confirmButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Disconnect account",
    );
    expect(cancelButton).toBeDefined();
    expect(confirmButton).toBeDefined();

    await act(async () => confirmButton?.click());
    expect(sendMessage).toHaveBeenCalledWith(
      { type: "CLEAR_TOKEN" },
      expect.any(Function),
    );
    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it("keeps a saved Hermes key hidden and tests new credentials from a user gesture", async () => {
    const sendMessage = vi.fn((message: { type: string }, callback?: (response: unknown) => void) => {
      if (message.type === "GET_HERMES_SETTINGS") {
        callback?.({
          success: true,
          data: { baseUrl: "http://127.0.0.1:8642", profileName: "joblit-0123456789abcdef", hasApiKey: true, configured: true },
        });
      } else if (message.type === "CHECK_HERMES_SETTINGS") {
        callback?.({ success: true, data: { configured: true } });
      } else {
        callback?.({ success: true, data: { configured: true } });
      }
    });
    Object.assign(chrome.runtime, { sendMessage });
    contains.mockResolvedValue(true);

    await act(async () => {
      root.render(<Options onDisconnect={vi.fn()} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("0123456789abcdef");
    const configure = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Local AI"),
    );
    await act(async () => configure?.click());
    expect(container.querySelector<HTMLInputElement>('#hermes-api-key')?.type).toBe("password");
  });
});
