import { afterEach, describe, expect, it, vi } from "vitest";
import { mountWidget, unmountWidget } from "./mount";

afterEach(() => {
  unmountWidget();
});

describe("floating widget interaction styles", () => {
  it("applies a background-provided position without reading extension storage", () => {
    const getSpy = vi.spyOn(chrome.storage.local, "get");
    const mounted = mountWidget({ right: "32px", bottom: "48px" });
    expect(mounted?.container.style.right).toBe("32px");
    expect(mounted?.container.style.bottom).toBe("48px");
    expect(getSpy).not.toHaveBeenCalled();
  });
  it("keeps edit controls keyboard-discoverable with visible focus and 44px targets", () => {
    const mounted = mountWidget();
    const styles = mounted?.shadowRoot.querySelector("style")?.textContent ?? "";

    expect(styles).toContain(".jf-field-item:focus-within .jf-edit-btn");
    expect(styles).toMatch(/\.jf-edit-input\s*\{[^}]*min-height:\s*44px/s);
    expect(styles).toMatch(/\.jf-edit-confirm, \.jf-edit-cancel\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s);
    expect(styles).toMatch(/\.jf-field-value\s*\{[^}]*min-width:\s*0[^}]*flex:\s*1/s);
    expect(styles).toMatch(/\.jf-source-badge\s*\{[^}]*flex-shrink:\s*0/s);
    expect(styles).toContain("button:focus-visible");
  });

  it("adapts the expanded surface to narrow viewports and fully disables motion on request", () => {
    const mounted = mountWidget();
    const styles = mounted?.shadowRoot.querySelector("style")?.textContent ?? "";

    expect(styles).toContain("@media (max-width: 420px)");
    expect(styles).toContain("calc(100vw - 24px)");
    expect(styles).not.toContain("transition: all");
    expect(styles).not.toMatch(/\.jf-collapsed--has-fields\s*\{[^}]*animation:/s);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none\s*!important/);
  });
});
