import { cache } from "react";
import { createClient } from "@/services/supabase/server";

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
