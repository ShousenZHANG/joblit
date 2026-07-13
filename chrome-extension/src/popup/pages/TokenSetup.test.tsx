import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TokenSetup } from "./TokenSetup";

const actGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function enterValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("TokenSetup API Base errors", () => {
  let container: HTMLDivElement;
  let root: Root;
  const contains = vi.fn();
  const request = vi.fn();

  beforeEach(async () => {
    actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    contains.mockResolvedValue(false);
    request.mockResolvedValue(false);
    Object.assign(chrome, { permissions: { contains, request } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<TokenSetup onConnected={vi.fn()} />);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(chrome, "permissions");
    Reflect.deleteProperty(actGlobal, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("expands Advanced Settings when a custom origin permission is denied", async () => {
    const tokenInput = container.querySelector<HTMLInputElement>(
      'input[type="password"]',
    );
    expect(tokenInput).not.toBeNull();

    const advancedToggle = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Advanced Settings"));
    await act(async () => {
      advancedToggle?.click();
    });

    const apiBaseInput = container.querySelector<HTMLInputElement>(
      'input[type="url"]',
    );
    expect(apiBaseInput).not.toBeNull();

    await act(async () => {
      enterValue(tokenInput!, "jfext_test-token");
      enterValue(apiBaseInput!, "https://self-hosted.example.com");
    });

    const connectButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Connect to Joblit",
    );
    expect(connectButton).toBeDefined();

    await act(async () => {
      connectButton!.click();
    });

    expect(advancedToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Allow access to this self-hosted Joblit origin to continue.",
    );
    expect(apiBaseInput?.getAttribute("aria-invalid")).toBe("true");
    expect(tokenInput?.classList.contains("jl-input--error")).toBe(false);
  });

  it("associates field labels and removes collapsed advanced controls from focus order", () => {
    const tokenInput = container.querySelector<HTMLInputElement>(
      'input[type="password"]',
    );
    const tokenLabel = container.querySelector<HTMLLabelElement>(
      'label[for="joblit-token"]',
    );

    expect(tokenInput?.id).toBe("joblit-token");
    expect(tokenInput?.getAttribute("aria-describedby")).toContain("joblit-token-hint");
    expect(tokenLabel).not.toBeNull();
    expect(container.querySelector('input[type="url"]')).toBeNull();
  });
});
