import { cache } from "react";
import { createClient } from "@/services/supabase/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { lookupAppUserId } from "@/services/supabase/identity";
import type { UserOrganization } from "@/lib/roles";

export type AuthIdentity = {
  /**
   * The `public.users.id`. This is what every table's `user_id` FK points at,
   * and what every RLS policy resolves to — so it is what you almost always
   * want. It is NOT the Supabase Auth id; resolving between the two is this
   * module's job and nowhere else's.
   */
  id: string;
  /**
   * The Supabase Auth id (`auth.users.id`, the JWT `sub`). Only for calls into
   * Supabase Auth itself — `auth.admin.deleteUser`, `updateUserById`, and the
   * like. Never use it to filter an application table.
   */
  authUserId: string;
  email: string;
  userMetadata: Record<string, unknown>;
  role?: string;
};

// Validates the session from the JWT itself via getClaims(). With asymmetric
// signing keys this is a local WebCrypto check (no auth-server round trip);
// getClaims() still refreshes through getSession() under the hood when needed.
//
// The JWT only carries the auth id, so resolving `id` costs one indexed lookup
// on users.auth_user_id. getAuthClaims() memoizes it per request, so a render
// that touches identity ten times still pays for it once. It uses the
// service-role client deliberately: the RLS policy on `users` is itself defined
// in terms of app_user_id(), so reading through the anon client to answer "who
// am I" would be circular.
async function resolveAuthClaims(): Promise<AuthIdentity | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return null;

  const appUserId = await lookupAppUserId(claims.sub);

  // A valid session with no linked record means signup half-completed (the
  // handle_new_user trigger failed). Failing closed is correct — the account
  // cannot function, and inventing an id here would write orphaned rows.
  if (!appUserId) {
    console.error("Authenticated session has no public.users row", claims.sub);
    return null;
  }

  return {
    id: appUserId,
    authUserId: claims.sub,
    email: claims.email ?? "",
    userMetadata: (claims.user_metadata as Record<string, unknown>) ?? {},
    role: claims.role,
  };
}

// Per-request memoized: every render-phase caller in a single request shares
// one validation instead of each hitting auth independently.
export const getAuthClaims = cache(resolveAuthClaims);

// Back-compat identity accessor. Intentionally uncached so it stays predictable
// outside a request scope (e.g. unit tests).
export async function getCurrentUser(): Promise<AuthIdentity | null> {
  return resolveAuthClaims();
}

/**
 * The caller's `public.users.id`, or null if unauthenticated. The app-side twin
 * of the `app_user_id()` SQL function — use it wherever you need to filter an
 * application table by the current user and don't need the rest of the identity.
 */
export async function getAppUserId(): Promise<string | null> {
  return (await getAuthClaims())?.id ?? null;
}

// To resolve an auth id that did NOT come from the current session — the id
// returned by auth.admin.createUser or inviteUserByEmail — import
// lookupAppUserId from @/services/supabase/identity directly. Deliberately not
// re-exported here, so there is exactly one import path for that seam.

export type NavUser = {
  claims: AuthIdentity;
  avatarUrl: string | null;
  organizations: UserOrganization[];
};

// Shape of a membership row with the org and role embedded (see the select
// below). Mirrors the pattern in the members API route.
type MembershipOrgRow = {
  organizations: {
    id: string;
    name: string;
    avatar_url: string | null;
  };
  roles: { name: string };
};

/**
 * All approved organizations the given user is a member of, with their role in
 * each — the data behind the navbar org switcher.
 *
 * SECURITY: this uses the service-role client (bypasses RLS, like every nav
 * path), so the `.eq("user_id", userId)` filter is the only thing scoping the
 * result to the caller. Always pass the authenticated `claims.id` here — never a
 * client-supplied id.
 */
export const getUserOrganizations = cache(
  async (userId: string): Promise<UserOrganization[]> => {
    const { data } = await supabaseAdmin
      .from("organization_memberships")
      // inner join so the org-level filters below actually drop rows rather than
      // keeping the membership with a null org embed.
      .select("organizations!inner(id, name, avatar_url), roles(name)")
      .eq("user_id", userId)
      .eq("organizations.approval_status", "approved")
      .is("organizations.deleted_at", null)
      .order("joined_at", { ascending: true });

    const rows = (data ?? []) as unknown as MembershipOrgRow[];
    return rows.map((m) => ({
      id: m.organizations.id,
      name: m.organizations.name,
      avatar_url: m.organizations.avatar_url ?? null,
      role: m.roles.name as UserOrganization["role"],
    }));
  },
);

// Resolves the signed-in user for the navbar: identity from the JWT, the avatar
// from the users table (the source of truth — avatar_url is never written to the
// JWT), and the org memberships behind the switcher. Cached per request, and
// since the root layout renders once per full page load (not on client-side
// navigation), these reads happen once per full load.
export const getNavUser = cache(async (): Promise<NavUser | null> => {
  const claims = await getAuthClaims();
  if (!claims) return null;
  const [{ data }, organizations] = await Promise.all([
    supabaseAdmin
      .from("users")
      .select("avatar_url")
      .eq("id", claims.id)
      .maybeSingle(),
    getUserOrganizations(claims.id),
  ]);
  return {
    claims,
    avatarUrl: (data?.avatar_url as string | null) ?? null,
    organizations,
  };
});

/**
 * Check if a user has a specific permission within an organization.
 * Follows: organization_memberships → role → role_permissions → permissions
 */
export async function hasOrgPermission(
  userId: string,
  organizationId: string,
  permissionKey: string,
): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("has_org_permission", {
    p_user_id: userId,
    p_org_id: organizationId,
    p_permission: permissionKey,
  });
  return data === true;
}

/**
 * Check if a user has a global-scope permission (e.g. platform admin).
 * Follows: user_global_roles → role → role_permissions → permissions
 */
export async function hasGlobalPermission(
  userId: string,
  permissionKey: string,
): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("has_global_permission", {
    p_user_id: userId,
    p_permission: permissionKey,
  });
  return data === true;
}

/**
 * Require a specific org permission. Throws if the user lacks it.
 */
export async function requireOrgPermission(
  userId: string,
  organizationId: string,
  permissionKey: string,
): Promise<void> {
  const allowed = await hasOrgPermission(userId, organizationId, permissionKey);
  if (!allowed) {
    throw new Error("Insufficient permissions");
  }
}

/**
 * Require a global permission (e.g. platform.manage). Throws if the user lacks it.
 */
export async function requireGlobalPermission(
  userId: string,
  permissionKey: string,
): Promise<void> {
  const allowed = await hasGlobalPermission(userId, permissionKey);
  if (!allowed) {
    throw new Error("Insufficient permissions");
  }
}
