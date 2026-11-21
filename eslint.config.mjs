import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import local from "./eslint-rules/no-comments.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
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
  {
    plugins: { local },
    rules: {
      "local/no-comments": "error",
    },
  },
  {
    files: ["src/lib/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(@/|(\.\./)+)(components|stores|app)(/|$)",
              message:
                "src/lib must not depend on components, stores, or app. Move the shared code into lib instead.",
            },
          ],
        },
      ],
    },
  },
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
  globalIgnores([
    ".claude/**",
    ".next/**",
    "build/**",
    "next-env.d.ts",
    "out/**",
  ]),
]);

export default eslintConfig;
