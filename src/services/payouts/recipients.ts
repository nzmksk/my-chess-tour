import { supabaseAdmin } from "@/services/supabase/admin";
import type { EmailRecipient } from "@/services/email/recipients";

const NOTIFY_ROLES = ["owner", "admin"];

interface MembershipRecipient {
  user: { email: string | null; first_name: string | null } | null;
  roles: { name: string } | null;
}

export async function loadOrganizationRecipients(
  organizationIds: string[],
): Promise<Map<string, EmailRecipient>> {
  const [membersRes, orgsRes] = await Promise.all([
    supabaseAdmin
      .from("organization_memberships")
      .select("user:users(email, first_name), roles!inner(name)")
      .in("organization_id", organizationIds),
    supabaseAdmin
      .from("organizations")
      .select("name, email")
      .in("id", organizationIds),
  ]);

  if (membersRes.error) throw new Error(membersRes.error.message);
  if (orgsRes.error) {
    console.error(
      "Payout emails: failed to load organization contact addresses",
      orgsRes.error.message,
    );
  }

  const recipients = new Map<string, EmailRecipient>();
  for (const m of membersRes.data as unknown as MembershipRecipient[]) {
    if (!m.roles || !NOTIFY_ROLES.includes(m.roles.name)) continue;
    const email = m.user?.email;
    if (!email) continue;
    recipients.set(email.toLowerCase(), {
      email,
      name: m.user?.first_name ?? "there",
    });
  }

  const orgs = (orgsRes.data ?? []) as { name: string | null; email: string | null }[];
  for (const org of orgs) {
    if (org.email && !recipients.has(org.email.toLowerCase())) {
      recipients.set(org.email.toLowerCase(), {
        email: org.email,
        name: org.name ?? "there",
      });
    }
  }
  return recipients;
}

export async function loadPlatformAdminRecipients(): Promise<Map<string, EmailRecipient>> {
  const { data, error } = await supabaseAdmin.rpc("list_global_permission_holders", {
    p_permission: "platform.manage",
  });
  if (error) throw new Error(error.message);

  const recipients = new Map<string, EmailRecipient>();
  for (const row of (data ?? []) as { email: string | null; first_name: string | null }[]) {
    if (!row.email) continue;
    recipients.set(row.email.toLowerCase(), {
      email: row.email,
      name: row.first_name ?? "there",
    });
  }
  return recipients;
}
