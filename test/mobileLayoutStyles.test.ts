import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("mobile layout style contracts", () => {
  it("does not use fixed viewport subtraction heights for app-shell", () => {
    const cssPath = join(process.cwd(), "app", "globals.css");
    const css = readFileSync(cssPath, "utf8");

    expect(css.includes("height: calc(100vh - 104px);")).toBe(false);
    expect(css.includes("height: calc(100dvh - 104px);")).toBe(false);
    expect(css.includes("height: calc(100vh - 112px);")).toBe(false);
    expect(css.includes("height: calc(100dvh - 112px);")).toBe(false);
  });

  it("keeps mobile scroll containers momentum-friendly and contained", () => {
    const cssPath = join(process.cwd(), "app", "globals.css");
    const css = readFileSync(cssPath, "utf8");

    // Block-scoped regex (`[^}]*`) keeps each assertion bound to its
    // own CSS rule body so that adding the property to an unrelated
    // selector elsewhere in the file cannot mask its removal here.
    expect(css).toMatch(/\.app-shell\s*\{[^}]*-webkit-overflow-scrolling:\s*touch;/);
    expect(css).toMatch(/\.app-shell\s*\{[^}]*overscroll-behavior-y:\s*contain;/);
    expect(css).toMatch(
      /\.jobs-scroll-area \[data-radix-scroll-area-viewport\]\s*\{[^}]*overscroll-behavior:\s*contain;/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.joblit-list-item\s*\{[^}]*transition:\s*none;/,
    );
  });

  it("expands compact buttons to 44x44 and keeps shared controls touch-safe on coarse pointers", () => {
    const cssPath = join(process.cwd(), "app", "globals.css");
    const css = readFileSync(cssPath, "utf8");

    expect(css).toMatch(
      /@media \(pointer:\s*coarse\)\s*\{\s*\[data-slot="button"\],\s*\[data-slot="input"\],\s*\[data-slot="select-trigger"\],\s*\[data-slot="select-item"\],\s*\[data-slot="dialog-close"\]\s*\{[^}]*min-height:\s*44px;/,
    );
    expect(css).toMatch(
      /@media \(pointer:\s*coarse\)\s*\{[\s\S]*?\[data-slot="button"\],\s*\[data-slot="dialog-close"\]\s*\{[^}]*min-width:\s*44px;/,
    );
  });
});
