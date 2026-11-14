import { getRoleConfig } from "@/lib/auth/roles";

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
