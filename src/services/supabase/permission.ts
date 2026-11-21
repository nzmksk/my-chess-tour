import { cache } from "react";
import { createClient } from "@/services/supabase/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { lookupAppUserId } from "@/services/supabase/identity";
import { noteAuditActor } from "@/services/supabase/audit-context";
import type { UserOrganization } from "@/lib/auth/roles";

export type AuthIdentity = {
  id: string;
  authUserId: string;
  email: string;
  userMetadata: Record<string, unknown>;
  role?: string;
};

async function resolveAuthClaims(): Promise<AuthIdentity | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return null;

  const appUserId = await lookupAppUserId(claims.sub);

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

const resolveAuthClaimsOnce = cache(resolveAuthClaims);

export async function getAuthClaims(): Promise<AuthIdentity | null> {
  const claims = await resolveAuthClaimsOnce();
  if (claims) noteAuditActor(claims.id);
  return claims;
}

export async function getCurrentUser(): Promise<AuthIdentity | null> {
  const claims = await resolveAuthClaims();
  if (claims) noteAuditActor(claims.id);
  return claims;
}

export async function getAppUserId(): Promise<string | null> {
  return (await getAuthClaims())?.id ?? null;
}

export type NavUser = {
  claims: AuthIdentity;
  avatarUrl: string | null;
  organizations: UserOrganization[];
};

type MembershipOrgRow = {
  organizations: {
    id: string;
    name: string;
    avatar_url: string | null;
  };
  roles: { name: string };
};

export const getUserOrganizations = cache(
  async (userId: string): Promise<UserOrganization[]> => {
    const { data } = await supabaseAdmin
      .from("organization_memberships")
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

export async function requireGlobalPermission(
  userId: string,
  permissionKey: string,
): Promise<void> {
  const allowed = await hasGlobalPermission(userId, permissionKey);
  if (!allowed) {
    throw new Error("Insufficient permissions");
  }
}
