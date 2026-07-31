import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated code:
    "lib/generated/**",
    // Coverage report artifacts (v8 HTML + helper scripts):
    "coverage/**",
    // Local tooling / vendored skill packs not part of the product:
    "everything-claude-code/**",
  ]),
  // Honor the standard underscore-prefix convention for intentionally unused
  // bindings, and the rest-siblings pattern for "omit one field" destructuring.
  // These are the conventions used by Next.js's own templates and most TS
  // projects in the wild.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
]);

export default eslintConfig;
