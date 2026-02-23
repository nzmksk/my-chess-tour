import { createClient } from '@/lib/supabase/server';

type OrgRole = 'owner' | 'admin' | 'member';

export async function getCurrentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function getUserOrgRole(
  userId: string,
  organizerId: string
): Promise<OrgRole | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('organizer_members')
    .select('role')
    .eq('user_id', userId)
    .eq('organizer_id', organizerId)
    .single();
  return (data?.role as OrgRole) ?? null;
}

export async function requireOrgRole(
  userId: string,
  organizerId: string,
  minRole: OrgRole
): Promise<void> {
  const role = await getUserOrgRole(userId, organizerId);
  const hierarchy: OrgRole[] = ['member', 'admin', 'owner'];
  if (!role || hierarchy.indexOf(role) < hierarchy.indexOf(minRole)) {
    throw new Error('Insufficient permissions');
  }
}

export async function requireAdmin(userId: string): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .single();
  if (!data?.role?.includes('admin')) {
    throw new Error('Admin access required');
  }
}
