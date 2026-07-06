// Single source of truth for organization roles and their badge styling, shared
// by the members list and the org switcher so the two never drift.

export type Role = "owner" | "admin" | "member";

// An organization the signed-in user belongs to, as surfaced in the navbar
// switcher. Defined here (not in permission.ts) so the auth store can import the
// type without pulling in server-only Supabase code.
export type UserOrganization = {
  id: string;
  name: string;
  avatar_url: string | null;
  role: Role;
};

export const ROLE_CONFIG: Record<Role, { label: string; className: string }> = {
  owner: {
    label: "Owner",
    className: "bg-gold-ghost text-gold-bright border border-gold-dim",
  },
  admin: {
    label: "Admin",
    className: "bg-info-bg text-info border border-info-border",
  },
  member: {
    label: "Member",
    className: "bg-bg-raised text-text-secondary border border-border",
  },
};

export function getRoleConfig(role: string) {
  return ROLE_CONFIG[role as Role] ?? ROLE_CONFIG.member;
}

/** Pill badge for an organization role (Owner / Admin / Member). */
export function RoleBadge({
  role,
  className = "",
}: {
  role: string;
  className?: string;
}) {
  const config = getRoleConfig(role);
  return (
    <span
      className={`font-cinzel rounded px-1.5 py-0.5 text-[0.625rem] font-bold tracking-widest uppercase ${config.className} ${className}`}
    >
      {config.label}
    </span>
  );
}
