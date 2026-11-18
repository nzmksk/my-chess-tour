import { beforeEach, vi } from "vitest";
import { resetAfterCallbacks } from "./after";
import { appIdFor } from "./identity";

/**
 * `after` from `next/server` holds its callbacks until the test runs them with
 * `runAfterCallbacks()` (see ./after). The rest of `next/server` is real.
 */
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (await import("./after")).after,
}));

beforeEach(() => {
  resetAfterCallbacks();
});

/**
 * Global stub for the auth-id → users.id bridge.
 *
 * Resolving a session identity costs one lookup on `users.auth_user_id` (see
 * src/services/supabase/identity.ts). That is infrastructure: a route test
 * asserting "409 when the deadline has passed" should not have to hand-model it
 * in its `supabaseAdmin.from()` router just to reach the code under test.
 *
 * The stub returns a DIFFERENT id from the auth id on purpose. In production the
 * two are equal for every row that exists today (`handle_new_user` writes
 * `id = auth_user_id` for self-signup), which means a route that passes a raw
 * auth id into a query is indistinguishable from a correct one — exactly how the
 * checkout route kept doing it through a full sweep and a green suite. Forcing
 * them apart makes that a test failure rather than a bug that surfaces the day
 * managed records land (#504/#505).
 *
 * So in any test: `sub` on the mocked JWT is the AUTH id, and whatever reaches
 * an application table should be `appIdFor(sub)`.
 *
 * Two things to know:
 *   - The real implementation is exercised in
 *     `src/services/supabase/__tests__/identity.test.ts`, which unmocks this.
 *   - A test needing specific ids (or a null lookup, i.e. a session with no
 *     linked record) overrides this per case — see the identity-indirection
 *     block in the checkout route tests.
 */
vi.mock("@/services/supabase/identity", () => ({
  lookupAppUserId: vi.fn(async (authUserId: string) => appIdFor(authUserId)),
}));

/**
 * Global stub for the rate limiter's Redis counters (#613).
 *
 * Many routes call enforceRateLimit, and the real counter talks to Upstash,
 * which in a test would mean slow retries against a dummy URL. By default every
 * request is within its limits; a test checking a 429 makes `hitWindow`
 * return the seconds to wait:
 *
 *   vi.mocked(hitWindow).mockResolvedValueOnce(600);
 *
 * The real counter is exercised in
 * `src/services/rate-limit/__tests__/window.test.ts`, which unmocks this.
 */
vi.mock("@/services/rate-limit/window", () => ({
  hitWindow: vi.fn(async () => 0),
  countHit: vi.fn(async () => ({ count: 1, ttl: 60 })),
  peekCount: vi.fn(async () => 0),
  resetCount: vi.fn(async () => undefined),
}));
