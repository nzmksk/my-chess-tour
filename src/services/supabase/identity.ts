import { supabaseAdmin } from "@/services/supabase/admin";

/**
 * The bridge between Supabase Auth ids and `public.users.id`.
 *
 * These are two different identifier spaces. `users.auth_user_id` is the only
 * link between them, and this is the only place in the application that follows
 * it — the SQL twin is `app_user_id()` (db/migrations/003_functions_triggers.sql).
 *
 * They happen to hold the same value for every account today, because
 * `handle_new_user` writes `id = auth_user_id` for self-signup. That is an
 * implementation detail of self-signup, not an invariant: a record created for
 * someone without a login (#504) has a generated `id` and, until it is claimed
 * (#505), no `auth_user_id` at all.
 *
 * Deliberately its own module rather than an inline query in permission.ts:
 * being a separate seam means a route's tests don't have to model an identity
 * lookup they don't care about (see src/test/setup.ts).
 *
 * Uses the service-role client on purpose — the RLS policy on `users` is itself
 * written in terms of `app_user_id()`, so reading through the anon client to
 * answer "who am I" would be circular.
 *
 * @param authUserId a Supabase Auth id (a JWT `sub`, or the id returned by
 *   `auth.admin.createUser` / `inviteUserByEmail`)
 * @returns the linked `public.users.id`, or null when nothing is linked
 */
export async function lookupAppUserId(
  authUserId: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error) {
    console.error(
      "Failed to resolve app user id for auth user",
      authUserId,
      error,
    );
    return null;
  }

  return (data?.id as string | undefined) ?? null;
}
