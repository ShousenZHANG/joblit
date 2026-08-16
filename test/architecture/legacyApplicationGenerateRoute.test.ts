import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Generation is manual copy/paste only: the user pastes the prompt into any
 * chatbot and imports the JSON. The server holds no model key and exposes no
 * generation endpoint — these guards keep every retired server-side generation
 * surface from coming back (see ADR-0015, ADR-0022).
 */

const RETIRED_GENERATION = [
  ["app", "api", "applications", "generate", "route.ts"],
  ["app", "api", "applications", "generate-cover-letter", "route.ts"],
  ["app", "api", "application-batches", "[id]", "execute", "route.ts"],
  ["lib", "server", "applications", "generateApplicationArtifacts.ts"],
  ["lib", "server", "applications", "executeServerBatchTailoringTask.ts"],
  ["lib", "server", "ai", "tailorApplication.ts"],
  ["lib", "server", "ai", "providers.ts"],
] as const;

/**
 * The evidence ledger and its review pipeline were deleted with AI-added
 * bullets: both blocking rules only ever judged bullets and numeric claims, so
 * once bullets stopped being generated they cost two tables, a preview route
 * and a tailor workspace to guard one 350-character field. The summary is
 * guarded at the import boundary by `lib/server/ai/summaryLint.ts` instead.
 */
const RETIRED_REVIEW = [
  ["app", "api", "applications", "[id]", "preview"],
  ["app", "(app)", "jobs", "[id]", "tailor"],
  ["lib", "server", "ai", "evidenceLedger.ts"],
  ["lib", "server", "applications", "persistReviewLedger.ts"],
] as const;

describe("server-side generation stays retired", () => {
  it.each(
    RETIRED_GENERATION.map((segments) => [segments.join("/"), segments] as const),
  )("does not expose %s", (_label, segments) => {
    expect(existsSync(join(process.cwd(), ...segments))).toBe(false);
  });
});

describe("the evidence ledger and its review surfaces stay retired", () => {
  it.each(
    RETIRED_REVIEW.map((segments) => [segments.join("/"), segments] as const),
  )("does not expose %s", (_label, segments) => {
    expect(existsSync(join(process.cwd(), ...segments))).toBe(false);
  });
});
