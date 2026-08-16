import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTES = [
  ["app", "api", "applications", "[id]", "draft", "route.ts"],
  ["app", "api", "applications", "[id]", "discard", "route.ts"],
] as const;

const FORBIDDEN_IMPLEMENTATION_IMPORTS = [
  "@/lib/server/prisma",
  "applicationMutationLock",
  "applicationAiContentAggregate",
  "applicationPublication",
  "applicationRenderContextFence",
  "applicationSourceSnapshot",
  "mapResumeProfile",
] as const;

describe("Application Edit route seam", () => {
  it.each(ROUTES)("keeps %s/%s/%s/%s/%s/%s as an HTTP adapter", (...parts) => {
    const source = readFileSync(join(process.cwd(), ...parts), "utf8");

    expect(source).toContain(
      "@/lib/server/applications/applicationEdit",
    );
    for (const implementationImport of FORBIDDEN_IMPLEMENTATION_IMPORTS) {
      expect(source).not.toContain(implementationImport);
    }
  });
});
