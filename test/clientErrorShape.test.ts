import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Client-side gate on the error envelope.
 *
 * Every `app/api` route returns `{ error: { code, message, details? } }` —
 * asserted server-side by `test/api/routeSessionGuard.test.ts`. Client code
 * that treats `json.error` as a string therefore renders `[object Object]` or
 * silently fails a comparison. That happened twice: a delete flow compared
 * `json.error === "LAST_PROFILE"` and stopped matching, and a dozen call sites
 * threw `new Error(json?.error || "…")`.
 *
 * `fetchJson` exposes `code`, `message` and `details` off `ApiError`; prefer it.
 */

const ROOTS = ["app", "components", "lib/client", "hooks"];

function sourceFiles(dir: string, acc: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/node_modules|generated|\.next/.test(full)) continue;
      sourceFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const FILES = ROOTS.flatMap((root) => sourceFiles(join(process.cwd(), root))).map((file) => ({
  path: relative(process.cwd(), file).replace(/\\/g, "/"),
  source: readFileSync(file, "utf8"),
}));

describe("client error envelope", () => {
  it("finds source files to check", () => {
    expect(FILES.length).toBeGreaterThan(100);
  });

  it("never uses a parsed body's `error` field as a string", () => {
    // `json.error.message` / `.code` / `.details` are the envelope and fine;
    // a bare `json?.error` in a string position is not.
    const offenders = FILES.flatMap(({ path, source }) => {
      const hits = (
        source.match(
          /(?:\btypeof\s+)?\b\w*(?:json|body|payload|data)\??\.error\s*(?:\|\||\?\?|===|!==)/gi,
        ) ?? []
        // `typeof x.error === "object"` is the envelope narrowing, not string use.
      ).filter((hit) => !/^typeof\b/i.test(hit));
      return hits.length > 0 ? [`${path}: ${hits.join(", ")}`] : [];
    });
    expect(offenders).toEqual([]);
  });
});
