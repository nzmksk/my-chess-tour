import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    env: {
      UPSTASH_REDIS_REST_URL: "https://dummy.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "dummy",
    },
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
