import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const coarsePointerHeightPattern =
  /\[data-slot="button"\],\s*\[data-slot="input"\],\s*\[data-slot="select-trigger"\],\s*\[data-slot="select-item"\],\s*\[data-slot="dialog-close"\]\s*\{[^}]*min-height:\s*44px;/;
const coarsePointerWidthPattern =
  /\[data-slot="button"\],\s*\[data-slot="dialog-close"\]\s*\{[^}]*min-width:\s*44px;/;

function findClosingBrace(css: string, openingBrace: number) {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let inComment = false;

  for (let index = openingBrace; index < css.length; index += 1) {
    const character = css[index];
    const nextCharacter = css[index + 1];

    if (inComment) {
      if (character === "*" && nextCharacter === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      inComment = true;
      index += 1;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new Error("Unclosed CSS block");
}

function extractCoarsePointerMediaBlocks(css: string) {
  const mediaPattern = /@media\s*\(pointer:\s*coarse\)\s*\{/g;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = mediaPattern.exec(css)) !== null) {
    const openingBrace = css.indexOf("{", match.index);
    const closingBrace = findClosingBrace(css, openingBrace);
    blocks.push(css.slice(openingBrace + 1, closingBrace));
    mediaPattern.lastIndex = closingBrace + 1;
  }

  return blocks;
}

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
    const coarsePointerBlocks = extractCoarsePointerMediaBlocks(css);

    expect(coarsePointerBlocks).toEqual(
      expect.arrayContaining([
        expect.stringMatching(coarsePointerHeightPattern),
      ]),
    );
    expect(coarsePointerBlocks).toEqual(
      expect.arrayContaining([
        expect.stringMatching(coarsePointerWidthPattern),
      ]),
    );
  });

  it("rejects a button width rule moved outside the coarse-pointer media block", () => {
    const mutatedCss = `
      @media (pointer: coarse) {
        [data-slot="button"] {
          min-height: 44px;
        }
      }

      [data-slot="button"],
      [data-slot="dialog-close"] {
        min-width: 44px;
      }
    `;

    const coarsePointerBlocks = extractCoarsePointerMediaBlocks(mutatedCss);

    expect(coarsePointerBlocks).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(coarsePointerWidthPattern),
      ]),
    );
  });
});
