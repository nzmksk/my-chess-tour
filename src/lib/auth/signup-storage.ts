// Tab-scoped sessionStorage key for the in-progress signup form (email,
// password, profile fields). Owned by the signup multi-step context, and also
// seeded by login when it carries an unverified user into the verify step.
export const SIGNUP_FORM_STORAGE_KEY = "signup_form";

// Where to send someone once signup (or login's detour through the verify step)
// finishes, e.g. back to the invitation they were accepting. Tab-scoped like the
// form, and consumed on use so a later, unrelated signup in the tab starts clean.
export const SIGNUP_RETURN_TO_STORAGE_KEY = "signup_return_to";

/**
 * A path on this site, or null. Rejects absolute and protocol-relative URLs
 * (`//evil.example`, `/\evil.example`) so a stored or query-string value can
 * never send someone off-site.
 */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  return raw;
}

export function rememberSignupReturnTo(path: string): void {
  const safe = safeReturnPath(path);
  if (!safe) return;
  try {
    window.sessionStorage.setItem(SIGNUP_RETURN_TO_STORAGE_KEY, safe);
  } catch {
    // Unavailable storage only costs the return trip; signup still works.
  }
}

/** Reads and clears the stored return path. */
export function takeSignupReturnTo(): string | null {
  try {
    const stored = window.sessionStorage.getItem(SIGNUP_RETURN_TO_STORAGE_KEY);
    window.sessionStorage.removeItem(SIGNUP_RETURN_TO_STORAGE_KEY);
    return safeReturnPath(stored);
  } catch {
    return null;
  }
}
