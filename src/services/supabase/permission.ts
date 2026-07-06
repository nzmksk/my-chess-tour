import { cache } from "react";
import { createClient } from "@/services/supabase/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import type { UserOrganization } from "@/lib/roles";

export type AuthIdentity = {
  id: string;
  email: string;
  userMetadata: Record<string, unknown>;
  role?: string;
};

// Validates the session from the JWT itself via getClaims(). With asymmetric
// signing keys this is a local WebCrypto check (no auth-server round trip);
// getClaims() still refreshes through getSession() under the hood when needed.
async function resolveAuthClaims(): Promise<AuthIdentity | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return null;
  return {
    id: claims.sub,
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
