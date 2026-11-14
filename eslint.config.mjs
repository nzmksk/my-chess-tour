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
  // Database and auth-server error text describes the schema and must not reach
  // a response body (#487). Log it and return internalErrorResponse() instead.
  {
    files: ["src/app/api/**/*.ts"],
    ignores: ["**/__tests__/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Property[key.name='message'] > MemberExpression[property.name='message'][object.name=/^(e|err|error)$|(Err|Error)$/]",
          message:
            "Don't put an error's message in a response. Use internalErrorResponse() from @/lib/http/internal-error, or write a message for the user.",
        },
        {
          selector:
            "CallExpression[callee.name=/^(errorResponse|respond|fail|err|serverError)$/] > MemberExpression.arguments[property.name='message'][object.name=/^(e|err|error)$|(Err|Error)$/]",
          message:
            "Don't put an error's message in a response. Use internalErrorResponse() from @/lib/http/internal-error, or write a message for the user.",
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
