import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("legacy application generation routes", () => {
  it("does not expose the non-durable resume generation endpoint", () => {
    expect(
      existsSync(
        join(
          process.cwd(),
          "app",
          "api",
          "applications",
          "generate",
          "route.ts",
        ),
      ),
    ).toBe(false);
  });

  it("does not expose the non-durable cover generation endpoint", () => {
    expect(
      existsSync(
        join(
          process.cwd(),
          "app",
          "api",
          "applications",
          "generate-cover-letter",
          "route.ts",
        ),
      ),
    ).toBe(false);
  });
});
