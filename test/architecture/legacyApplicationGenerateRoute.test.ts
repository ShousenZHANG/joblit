import { existsSync, readFileSync } from "node:fs";
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

  it("keeps server generation behind the receipt-backed batch interface", () => {
    const legacyService = join(
      process.cwd(),
      "lib",
      "server",
      "applications",
      "generateApplicationArtifacts.ts",
    );
    const batchService = join(
      process.cwd(),
      "lib",
      "server",
      "applications",
      "executeServerBatchTailoringTask.ts",
    );
    const executeRoute = join(
      process.cwd(),
      "app",
      "api",
      "application-batches",
      "[id]",
      "execute",
      "route.ts",
    );

    expect(existsSync(legacyService)).toBe(false);
    expect(existsSync(batchService)).toBe(true);

    const serviceSource = readFileSync(batchService, "utf8");
    const inputInterface = serviceSource.match(
      /export type ExecuteServerBatchTailoringTaskInput = \{([\s\S]*?)\n\};/,
    )?.[1];
    expect(inputInterface).toBeDefined();
    expect(inputInterface).not.toContain("batch?:");
    expect(inputInterface).not.toContain("acceptedTargets:");
    expect(inputInterface).not.toContain("remainingTargets:");
    expect(serviceSource).toContain("expectedHash");

    const routeSource = readFileSync(executeRoute, "utf8");
    expect(routeSource).toContain("executeServerBatchTailoringTask");
    expect(routeSource).not.toContain("generateApplicationArtifactsForJob");
  });
});
