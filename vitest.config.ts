import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text"],
      exclude: [
        "node_modules/**",
        ".next/**",
        "**/__tests__/**",
        "**/*.config.*",
        "**/migrations/**",
      ],
    },
  },
});
