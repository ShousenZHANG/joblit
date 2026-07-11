import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@ext": resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "dist/**",
        "coverage/**",
      ],
      // Regression ratchet only: these floors sit immediately below the
      // measured baseline; they are not a claim that 80% coverage is reached.
      thresholds: {
        statements: 42,
        branches: 38,
        functions: 44,
        lines: 42,
      },
    },
    // Vitest 4 default `forks` pool intermittently fails to register suites
    // on Windows; `vmThreads` is stable for this jsdom-based test surface.
    pool: "vmThreads",
  },
});
