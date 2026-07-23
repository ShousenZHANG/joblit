import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@ext": resolve(__dirname, "src"),
      "@shared": resolve(__dirname, "..", "lib", "shared"),
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
        statements: 45.7,
        branches: 38.7,
        functions: 47.4,
        lines: 46.7,
      },
    },
    // Vitest 4 default `forks` pool intermittently fails to register suites
    // on Windows; `vmThreads` is stable for this jsdom-based test surface.
    pool: "vmThreads",
  },
});
