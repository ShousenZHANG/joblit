import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

vi.mock("@ext/shared/useI18n", () => ({
  useI18n: () => ({
    ready: true,
    locale: "en",
    t: (key: string) => ({
      "tab.home": "Home",
      "tab.profile": "Profile",
      "tab.settings": "Settings",
      "tabs.ariaLabel": "Extension navigation",
      "app.loading": "Loading...",
    })[key] ?? key,
  }),
}));

vi.mock("./pages/Dashboard", () => ({
  Dashboard: () => <div>Dashboard content</div>,
}));

vi.mock("./pages/ProfileSelect", () => ({
  ProfileSelect: () => <div>Profile content</div>,
}));

vi.mock("./pages/Options", () => ({
  Options: () => <div>Settings content</div>,
}));

const actGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("App navigation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalSendMessage: typeof chrome.runtime.sendMessage;

  beforeEach(async () => {
    actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    originalSendMessage = chrome.runtime.sendMessage;
    Object.assign(chrome.runtime, {
      sendMessage: vi.fn((_message: unknown, callback?: (response: unknown) => void) => {
        callback?.({ success: true, data: { authenticated: true } });
      }),
    });

    await act(async () => {
      root.render(<App />);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Object.assign(chrome.runtime, { sendMessage: originalSendMessage });
    Reflect.deleteProperty(actGlobal, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("exposes an accessible tab pattern", () => {
    const tablist = container.querySelector<HTMLElement>('[role="tablist"]');
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const panel = container.querySelector<HTMLElement>('[role="tabpanel"]');

    expect(tablist?.getAttribute("aria-label")).toBe("Extension navigation");
    expect(tabs).toHaveLength(3);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]?.tabIndex).toBe(0);
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("false");
    expect(tabs[1]?.tabIndex).toBe(-1);
    expect(panel?.getAttribute("aria-labelledby")).toBe(tabs[0]?.id);
  });

  it("supports arrow-key navigation and moves focus", async () => {
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));

    tabs[0]?.focus();
    await act(async () => {
      tabs[0]?.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
      }));
    });

    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[1]);
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain("Profile content");
  });
});
