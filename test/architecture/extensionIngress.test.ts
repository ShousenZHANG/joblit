import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { EXTENSION_ROUTE_OPERATIONS } from "@/lib/server/extensionIngress/extensionRoutePolicy";

const EXTENSION_API_ROOT = join(process.cwd(), "app", "api", "ext");

function routeFiles(): string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name === "route.ts") files.push(path);
    }
  };
  visit(EXTENSION_API_ROOT);
  return files;
}

const ROUTES = routeFiles().map((file) => ({
  path: relative(process.cwd(), file).replace(/\\/g, "/"),
  source: readFileSync(file, "utf8"),
}));

describe("Extension API ingress seam", () => {
  it("routes every Extension handler through the shared ingress", () => {
    expect(ROUTES).toHaveLength(11);
    const offenders = ROUTES.filter(
      ({ source }) => !source.includes("withExtensionRoute"),
    ).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("keeps auth, abuse budgets, cache policy, and reporting out of routes", () => {
    const forbidden = [
      /\brequireExtensionToken\b/,
      /\bcheckRateLimit\b/,
      /\brateLimitKeyFromRequest\b/,
      /\brateLimitHeaders\b/,
      /\breportError\b/,
      /\bwithSessionRoute\b/,
      /function\s+noStore\b/,
    ];
    const offenders = ROUTES.flatMap(({ path, source }) =>
      forbidden.some((pattern) => pattern.test(source)) ? [path] : [],
    );

    expect(offenders).toEqual([]);
  });

  it("assigns every operation policy to exactly one handler", () => {
    const combined = ROUTES.map(({ source }) => source).join("\n");
    const counts = Object.fromEntries(
      EXTENSION_ROUTE_OPERATIONS.map((operation) => [
        operation,
        [...combined.matchAll(new RegExp(`["']${operation}["']`, "g"))]
          .length,
      ]),
    );

    expect(counts).toEqual(
      Object.fromEntries(
        EXTENSION_ROUTE_OPERATIONS.map((operation) => [operation, 1]),
      ),
    );
  });
});
