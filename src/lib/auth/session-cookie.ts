export const SESSION_ONLY_COOKIE = "mct_session_only";

type CookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

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
