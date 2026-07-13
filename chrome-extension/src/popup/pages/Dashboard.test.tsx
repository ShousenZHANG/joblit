import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";

const actGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("Dashboard primary fill experience", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalSendMessage: typeof chrome.runtime.sendMessage;
  let closeSpy: ReturnType<typeof vi.spyOn>;
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    closeSpy = vi.spyOn(window, "close").mockImplementation(() => undefined);
    sendMessage = vi.fn((message: { type: string }, callback?: (response: unknown) => void) => {
      if (message.type === "GET_FLAT_PROFILE") {
        callback?.({
          success: true,
          data: {
            profileName: "Main profile",
            flat: {
              fullName: "Alex Chen",
              email: "alex@example.com",
              currentTitle: "Product Engineer",
              currentCompany: "Example",
            },
          },
        });
        return;
      }
      if (message.type === "GET_SUBMISSIONS") {
        callback?.({ success: true, data: [] });
        return;
      }
      if (message.type === "FILL_ACTIVE_TAB") {
        callback?.({
          success: true,
          filled: 3,
          skipped: 1,
          fields: [
            { filled: true, source: "profile" },
            { filled: true, source: "profile" },
            { filled: true, source: "historical" },
          ],
        });
      }
    });
    originalSendMessage = chrome.runtime.sendMessage;
    Object.assign(chrome.runtime, { sendMessage });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const DashboardWithoutLegacyProps = Dashboard as unknown as ComponentType;
    await act(async () => {
      root.render(createElement(DashboardWithoutLegacyProps));
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Object.assign(chrome.runtime, { sendMessage: originalSendMessage });
    closeSpy.mockRestore();
    vi.useRealTimers();
    Reflect.deleteProperty(actGlobal, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("keeps one stable action surface and never closes after a successful fill", async () => {
    const actionSurface = container.querySelector<HTMLElement>(".jl-action-surface");
    const fillButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Fill Current Page"),
    );

    expect(actionSurface?.dataset.state).toBe("idle");
    expect(fillButton).toBeDefined();

    await act(async () => {
      fillButton?.click();
    });

    expect(container.querySelector(".jl-action-surface")).toBe(actionSurface);
    expect(actionSurface?.dataset.state).toBe("success");

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("keeps account disconnection out of the primary task page", () => {
    expect(container.textContent).not.toContain("Disconnect");
  });

  it("requests only the three most recent submissions", () => {
    expect(sendMessage).toHaveBeenCalledWith(
      { type: "GET_SUBMISSIONS", params: { limit: 3 } },
      expect.any(Function),
    );
  });
});
