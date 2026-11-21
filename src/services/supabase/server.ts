import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { stripPersistence } from "@/lib/auth/session-cookie";

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
          } catch {}
        },
      },
    },
  );
}
