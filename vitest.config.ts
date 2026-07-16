import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // Vitest transforms dependencies on demand. Disabling Vite's HTML crawling
  // prevents the root suite from scanning the extension popup and its aliases.
  optimizeDeps: {
    noDiscovery: true,
    include: [],
  },
  resolve: {
    alias: {
      "@": rootDir,
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html"],
      include: ["lib/**", "app/**", "components/**"],
      exclude: [
        "lib/generated/**",
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "app/**/layout.tsx",
        "app/**/loading.tsx",
        "app/**/error.tsx",
        "app/**/not-found.tsx",
        "app/**/global-error.tsx",
      ],
      // RATCHET FLOOR, not an aspirational gate. Set just under the current
      // measured coverage so it cannot regress, then bump upward as suites
      // grow toward the 80% target in CLAUDE.md. A hard 80% today would be a
      // false gate (much app/ UI is still untested); locking the floor is the
      // honest move and still blocks any drop.
      thresholds: {
        statements: 57.7,
        branches: 46.5,
        functions: 54.1,
        lines: 60.3,
      },
    },
    // Vitest 4 default `forks` pool fails to register suites on Windows in this
    // project (suites resolve before the worker registers them). `vmThreads`
    // is stable here and keeps memory bounded.
    pool: "vmThreads",
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      // Chrome extension has its own Vitest config; do not pull it into the
      // root run.
      "chrome-extension/**",
      // Local tooling / vendored skill packs ship their own ad-hoc test
      // harnesses that call `process.exit` and are not product code.
      "everything-claude-code/**",
      // Hermes package policy suites use Node's built-in test runner.
      "tools/hermes/**/*.test.mjs",
    ],
  },
});
