import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Normalise line endings so the positional assertions hold on both LF and
// CRLF working copies (Windows checkouts rewrite this file to CRLF).
const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8").replace(
  /\r\n/g,
  "\n",
);

describe("landing motion CSS contracts", () => {
  it("pauses starfield animation after all light-mode animation shorthands", () => {
    const lastShimmerDeclaration = css.lastIndexOf("animation: star-shimmer");
    const lightPauseRule = css.indexOf(
      ".starfield-far,\n.starfield-mid,\n.starfield-near",
    );

    expect(lightPauseRule).toBeGreaterThan(lastShimmerDeclaration);
    expect(css.slice(lightPauseRule)).toContain("animation-play-state: paused");
    expect(css.slice(lightPauseRule)).toContain(".dark .starfield-far");
    expect(css.slice(lightPauseRule)).toContain("animation-play-state: running");
  });

  it("does not retain selectors for the retired Extension guide", () => {
    expect(css).not.toContain("extension-guide-surface");
  });
});
