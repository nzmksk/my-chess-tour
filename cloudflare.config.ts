import { bindings, defineConfig, defineWorker } from "cf/config";
import { createWorkersResponseStoreSelfContainedConfig } from "@vinext/cloudflare/cache/config";

const cache = await createWorkersResponseStoreSelfContainedConfig({
  worker: "my-chess-tour-staging",
  bucket: "my-chess-tour-staging-response-store-cache-bodies",
});

export default defineConfig({
  worker: defineWorker({
    ...cache,
    name: "my-chess-tour-staging",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-11-26",
    compatibilityFlags: ["nodejs_compat"],
    placement: { mode: "smart" },
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ...cache.env,
      ASSETS: bindings.assets(),
      SUPABASE_SECRET_KEY: bindings.secret(),
      CHIP_API_KEY: bindings.secret(),
      CHIP_BRAND_ID: bindings.secret(),
      CHIP_WEBHOOK_PUBLIC_KEY: bindings.secret(),
      CHIP_SEND_API_URL: bindings.secret(),
      CHIP_SEND_API_KEY: bindings.secret(),
      CHIP_SEND_API_SECRET: bindings.secret(),
      CHIP_SEND_WEBHOOK_PUBLIC_KEY: bindings.secret(),
      RESEND_API_KEY: bindings.secret(),
      RESEND_FROM_EMAIL: bindings.secret(),
      UPSTASH_REDIS_REST_URL: bindings.secret(),
      UPSTASH_REDIS_REST_TOKEN: bindings.secret(),
      CRON_SECRET: bindings.secret(),
      GITHUB_TOKEN: bindings.secret(),
      GITHUB_WEBHOOK_SECRET: bindings.secret(),
    },
  }),
});
