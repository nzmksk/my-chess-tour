import { createClient } from '@/lib/supabase/server';

export async function getCurrentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/**
 * Check if a user has a specific permission within an organization.
 * Follows: organization_memberships → role → role_permissions → permissions
 */
export async function hasOrgPermission(
  userId: string,
  organizationId: string,
  permissionKey: string
): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .rpc('has_org_permission', {
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
  permissionKey: string
): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .rpc('has_global_permission', {
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
  permissionKey: string
): Promise<void> {
  const allowed = await hasOrgPermission(userId, organizationId, permissionKey);
  if (!allowed) {
    throw new Error('Insufficient permissions');
  }
}

/**
 * Require a global permission (e.g. platform.manage). Throws if the user lacks it.
 */
export async function requireGlobalPermission(
  userId: string,
  permissionKey: string
): Promise<void> {
  const allowed = await hasGlobalPermission(userId, permissionKey);
  if (!allowed) {
    throw new Error('Insufficient permissions');
  }
}
