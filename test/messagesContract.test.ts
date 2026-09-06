import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import zh from "../messages/zh.json";

/**
 * Contract tests for the two UI Locale string tables.
 *
 * `messages/en.json` and `messages/zh.json` are the most-churned files in the
 * repo. next-intl resolves a missing key at runtime, so drift surfaces as a
 * Chinese user seeing an English string rather than as a build failure. These
 * two assertions are the gate that turns that into a test failure.
 */

/** Reduce a message tree to its key structure and leaf types. */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, shape(child)]),
    );
  }
  return typeof value;
}

/** Flatten a message tree to dotted leaf paths. */
function leafPaths(value: unknown, prefix = "", acc: string[] = []): string[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      leafPaths(child, prefix ? `${prefix}.${key}` : key, acc);
    }
    return acc;
  }
  if (prefix) acc.push(prefix);
  return acc;
}

/**
 * Keys resolved through a template literal rather than a string literal, so a
 * reference scan cannot see them. Each entry names the call site that builds
 * the key — add to this list only alongside such a call site.
 */
const DYNAMIC_KEY_PREFIXES: readonly { pattern: RegExp; callSite: string }[] = [
  { pattern: /^guide\.task_/, callSite: "components/guide/GuideTaskList.tsx — t(`task_${task.id}_title`)" },
  { pattern: /^landingExperience\.gettingStarted\.step\d(?:Title|Description)$/, callSite: "components/landing/ProductSections.tsx — t(`gettingStarted.step${step}Title`), t(`gettingStarted.step${step}Description`)" },
];

const SOURCE_ROOTS = ["app", "components", "lib", "hooks", "i18n", "test", "integrations"];

function readSourceCorpus(): string {
  const chunks: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (/node_modules|generated|dist|coverage|\.next/.test(full)) continue;
        walk(full);
      } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
        chunks.push(readFileSync(full, "utf8"));
      }
    }
  };
  for (const root of SOURCE_ROOTS) walk(join(process.cwd(), root));
  return chunks.join("\n");
}

describe("UI Locale message contract", () => {
  it("keeps the en and zh key structures identical", () => {
    expect(shape(zh)).toEqual(shape(en));
  });

  it("references every message key from source", () => {
    const corpus = readSourceCorpus();
    const unreferenced = leafPaths(en).filter((path) => {
      if (DYNAMIC_KEY_PREFIXES.some(({ pattern }) => pattern.test(path))) return false;
      const leaf = path
        .split(".")
        .filter((segment) => !/^\d+$/.test(segment))
        .at(-1);
      return leaf ? !corpus.includes(leaf) : false;
    });
    expect(unreferenced).toEqual([]);
  });
});
