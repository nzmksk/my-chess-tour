// Marker cookie that records the user's "Keep me signed in" choice. When set,
// the Supabase auth cookies are written WITHOUT `maxAge`/`expires` so the
// browser treats them as session cookies (cleared when the browser closes).
// It is itself a session cookie, so it disappears alongside the auth cookies.
export const SESSION_ONLY_COOKIE = "mct_session_only";

type CookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

// Strip persistence (`maxAge`/`expires`) from Supabase auth cookies so they
// become session-scoped. Non-`sb-` cookies are returned untouched.
export function stripPersistence<T extends CookieToSet>(
  cookiesToSet: T[],
): T[] {
  return cookiesToSet.map((cookie) => {
    if (!cookie.name.startsWith("sb-")) return cookie;
    const options = { ...(cookie.options ?? {}) };
    delete options.maxAge;
    delete options.expires;
    return { ...cookie, options };
  });
}
