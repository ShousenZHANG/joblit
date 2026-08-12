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
 * secret, an agent credential, the NextAuth handler itself, or a
 * deliberately public endpoint. None of them may use the session wrapper.
 */
const NON_SESSION_ROUTES = new Set([
  "app/api/auth/[...nextauth]/route.ts",
  "app/api/fetch-runs/cleanup-stuck/route.ts",
  "app/api/fetch-runs/[id]/commit/route.ts",
  "app/api/fetch-runs/[id]/config/route.ts",
  "app/api/artifacts/reconcile/route.ts",
  "app/api/me/route.ts",
]);

describe("route session seam", () => {
  it("finds route files to check", () => {
    // 15 API routes went with the Runner, the batch queue and agent tokens.
    expect(ROUTES.length).toBeGreaterThan(25);
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
      // withAgentRoute went with the batch protocol. Every authenticated
      // route is a browser session now, so there is one wrapper to check.
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

  /**
   * One error envelope: `{ error: { code, message, details? }, requestId? }`.
   * The flat `{ error: "CODE" }` shape forced the client to guess which of
   * three shapes it had received — see `extractErrorMessage` in
   * `lib/api/fetchJson.ts`.
   */
  it("never returns the flat error shape", () => {
    const offenders = ROUTES.flatMap(({ path, source }) => {
      // Any `error` key in a response body that is not the `{code, message}`
      // object. Matching on a string literal alone missed a case where the
      // value was a ternary picking between two codes, so this asserts the
      // shape instead: `error:` must be followed by `{`.
      //
      // Only a response body counts. `error:` also names a persisted column —
      // `failQueuedRun({ error: "GITHUB_DISPATCH_FAILED" })` writes
      // `FetchRun.error` and is not a wire shape.
      const hits = [
        ...source.matchAll(/NextResponse\.json\(\s*\{\s*error:\s*(\S)/g),
      ].filter((match) => match[1] !== "{");
      return hits.length > 0 ? [`${path} (${hits.length})`] : [];
    });
    expect(offenders).toEqual([]);
  });
});
