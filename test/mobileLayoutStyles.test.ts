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

    expect(css).toMatch(/\.app-shell\s*{[\s\S]*-webkit-overflow-scrolling:\s*touch;/);
    expect(css).toMatch(/\.app-shell\s*{[\s\S]*overscroll-behavior-y:\s*contain;/);
    expect(css).toMatch(
      /\.jobs-scroll-area \[data-radix-scroll-area-viewport\]\s*{[\s\S]*overscroll-behavior:\s*contain;/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*{[\s\S]*\.joblit-list-item[\s\S]*transition:\s*none;/,
    );
  });
});
