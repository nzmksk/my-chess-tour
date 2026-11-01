// Field rules shared by the two surfaces that write an organization's public
// profile: the application POST (which creates the row) and the settings PATCH
// (which edits it). They must agree — an organizer who cannot re-save what they
// originally submitted is a bug, and the only way to guarantee that is one copy
// of each rule.

export interface OrgLink {
  url: string;
  label: string;
}

/**
 * Returns an error message, or null when `value` is an acceptable links array.
 * `null`/absent is acceptable — links are optional.
 */
export function validateOrgLinks(value: unknown): string | null {
  if (value == null) return null;

  if (!Array.isArray(value)) return "links must be an array";

  for (const link of value) {
    if (!link || typeof link !== "object" || Array.isArray(link)) {
      return "Each link must be an object with label and url";
    }

    const l = link as Record<string, unknown>;

    if (typeof l.label !== "string" || l.label.trim() === "") {
      return "Each link must have a non-empty label";
    }

    if (typeof l.url !== "string" || l.url.trim() === "") {
      return "Each link must have a non-empty url";
    }
  }

  return null;
}

/**
 * The only avatar URLs an organization may claim: objects in its own folder of
 * the public avatars bucket, which is exactly what the storage policy in
 * 005_bucket_policies.sql lets an org manager write. Without the prefix check a
 * client could point avatar_url at any URL on the internet and have the
 * platform render it as that organization's identity.
 */
export function orgAvatarPrefix(orgId: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/organizations/${orgId}/`;
}
