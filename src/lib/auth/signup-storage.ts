export const SIGNUP_FORM_STORAGE_KEY = "signup_form";

export const SIGNUP_RETURN_TO_STORAGE_KEY = "signup_return_to";

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
  } catch {}
}

export function takeSignupReturnTo(): string | null {
  try {
    const stored = window.sessionStorage.getItem(SIGNUP_RETURN_TO_STORAGE_KEY);
    window.sessionStorage.removeItem(SIGNUP_RETURN_TO_STORAGE_KEY);
    return safeReturnPath(stored);
  } catch {
    return null;
  }
}
