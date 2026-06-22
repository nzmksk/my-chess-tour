import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { stripPersistence } from "@/lib/session-cookie";

// `sessionOnly` writes the Supabase auth cookies without `maxAge`/`expires`, so
// the session clears when the browser closes (used when the user did not check
// "Keep me signed in").
export async function createClient(opts?: { sessionOnly?: boolean }) {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          const toSet = opts?.sessionOnly
            ? stripPersistence(cookiesToSet)
            : cookiesToSet;
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // The `setAll` method is called from a Server Component
            // which cannot set cookies. This can be ignored if
            // middleware handles refreshing.
          }
        },
      },
    },
  );
}
