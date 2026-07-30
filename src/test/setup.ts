import { vi } from "vitest";

/**
 * Global default for the auth-id → users.id bridge.
 *
 * Resolving a session identity now costs one lookup on `users.auth_user_id`
 * (see src/services/supabase/identity.ts). That is infrastructure: a route test
 * asserting "409 when the deadline has passed" should not have to hand-model it
 * in its `supabaseAdmin.from()` router just to reach the code under test.
 *
 * The default returns the auth id unchanged, which is exactly what the database
 * returns today — `handle_new_user` writes `id = auth_user_id` for every
 * self-signup account, so the two are equal for every row that exists. Tests
 * therefore behave as they did before the indirection was introduced.
 *
 * Two things to know:
 *   - The real implementation is exercised directly in
 *     `src/services/supabase/__tests__/identity.test.ts`, which unmocks this.
 *   - Any test that needs the ids to DIVERGE (a managed record, a claimed
 *     account — #504/#505) must override this mock explicitly rather than rely
 *     on the default, which deliberately models only the self-signup case.
 */
vi.mock("@/services/supabase/identity", () => ({
  lookupAppUserId: vi.fn(async (authUserId: string) => authUserId),
}));
