"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/services/supabase/server";
import { SESSION_ONLY_COOKIE } from "@/lib/session-cookie";

export async function logout(): Promise<never> {
  const supabase = await createClient();
  // Sign out this device only — matches the "This device only" copy on the
  // confirmation and logout screens.
  await supabase.auth.signOut({ scope: "local" });

  const cookieStore = await cookies();
  cookieStore.delete(SESSION_ONLY_COOKIE);

  redirect("/auth/logout");
}
