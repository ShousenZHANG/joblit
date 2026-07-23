import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural gate on the route layer's session seam.
 *
 * `withSessionRoute` reports unexpected errors through the observability seam
 * before rethrowing (`lib/server/api/routeHandler.ts`). A hand-copied preamble
 * that catches `UnauthorizedError` inline looks equivalent and is not — it
 * drops that reporting, so an unexpected throw in that route is invisible in
 * production.
 *
 * These assertions keep the copies from coming back.
 */

const API_ROOT = join(process.cwd(), "app", "api");

function routeFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) routeFiles(full, acc);
    else if (entry.name === "route.ts") acc.push(full);
  }
  return acc;
}

const ROUTES = routeFiles(API_ROOT).map((file) => ({
  path: relative(process.cwd(), file).replace(/\\/g, "/"),
  source: readFileSync(file, "utf8"),
}));

/**
 * Routes authenticated by something other than a NextAuth session: a service
 * secret, an extension bearer token, the NextAuth handler itself, or a
 * deliberately public endpoint. None of them may use the session wrapper.
 */
const NON_SESSION_ROUTES = new Set([
  "app/api/auth/[...nextauth]/route.ts",
  "app/api/admin/import/route.ts",
  "app/api/fetch-runs/cleanup-stuck/route.ts",
  "app/api/fetch-runs/[id]/update/route.ts",
  "app/api/fetch-runs/[id]/config/route.ts",
  "app/api/discover/refresh-daily/route.ts",
  "app/api/me/route.ts",
]);

describe("route session seam", () => {
  it("finds route files to check", () => {
    expect(ROUTES.length).toBeGreaterThan(60);
  });

  it("never hand-rolls the UnauthorizedError preamble", () => {
    const offenders = ROUTES.filter(({ source }) =>
      source.includes("instanceof UnauthorizedError"),
    ).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("never calls requireSession outside the wrapper", () => {
    const offenders = ROUTES.filter(({ source }) =>
      /\bawait requireSession(WithEmail)?\(\)/.test(source),
    ).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("routes every session-authenticated handler through the wrapper", () => {
    const offenders = ROUTES.filter(({ path, source }) => {
      if (NON_SESSION_ROUTES.has(path)) return false;
      if (source.includes("requireExtensionToken")) return false;
      return !/with(Email)?SessionRoute/.test(source);
    }).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  /**
   * Route *params* come from `lib/shared/schemas/common`; a route may still
   * declare uuid-shaped body or query fields, which are genuinely local.
   */
  it("declares no route-local param schema", () => {
    const offenders = ROUTES.filter(({ source }) =>
      /const \w*ParamsSchema\s*=/.test(source),
    ).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});
