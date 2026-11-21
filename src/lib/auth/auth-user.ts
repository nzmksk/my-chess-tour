export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  initials: string;
};

type MetadataSource = {
  id?: string;
  sub?: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

export function toAuthUser(
  source: MetadataSource | null | undefined,
): AuthUser | null {
  if (!source) return null;
  const id = source.id ?? source.sub;
  if (!id) return null;

  const meta = source.user_metadata ?? {};
  const firstName: string =
    (meta.first_name as string) ?? (meta.firstName as string) ?? "";
  const lastName: string =
    (meta.last_name as string) ?? (meta.lastName as string) ?? "";
  const email = source.email ?? "";
  const initials =
    [firstName[0], lastName[0]].filter(Boolean).join("").toUpperCase() ||
    (email[0]?.toUpperCase() ?? "?");

  return {
    id,
    email,
    fullName: [firstName, lastName].filter(Boolean).join(" ") || email,
    initials,
  };
}
