import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Generation is local-first: the Runner drives the user's own model through
 * a loopback Hermes gateway, and the manual external-model import is the
 * zero-install path. The server holds no model key and exposes no generation
 * endpoint — these guards keep every retired server-side generation surface
 * from coming back (see ADR-0015).
 */

const RETIRED = [
  ["app", "api", "applications", "generate", "route.ts"],
  ["app", "api", "applications", "generate-cover-letter", "route.ts"],
  ["app", "api", "application-batches", "[id]", "execute", "route.ts"],
  ["lib", "server", "applications", "generateApplicationArtifacts.ts"],
  ["lib", "server", "applications", "executeServerBatchTailoringTask.ts"],
  ["lib", "server", "ai", "tailorApplication.ts"],
  ["lib", "server", "ai", "providers.ts"],
] as const;

describe("server-side generation stays retired", () => {
  it.each(RETIRED.map((segments) => [segments.join("/"), segments] as const))(
    "does not expose %s",
    (_label, segments) => {
      expect(existsSync(join(process.cwd(), ...segments))).toBe(false);
    },
  );
});
