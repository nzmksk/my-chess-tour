import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Honor the `_`-prefix convention for intentionally-unused vars/args.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // src/lib holds framework-agnostic helpers shared across the app, so it must
  // sit below the UI and state layers: it may not import components, stores,
  // or app code (which all import lib).
  {
    files: ["src/lib/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(@/|(\\.\\./)+)(components|stores|app)(/|$)",
              message:
                "src/lib must not depend on components, stores, or app. Move the shared code into lib instead.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".claude/**",
    ".next/**",
    "build/**",
    "next-env.d.ts",
    "out/**",
  ]),
]);

export default eslintConfig;
