import { supabaseAdmin } from "@/services/supabase/admin";

export async function lookupAppUserId(
  authUserId: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error) {
    console.error(
      "Failed to resolve app user id for auth user",
      authUserId,
      error,
    );
    return null;
  }

  return (data?.id as string | undefined) ?? null;
}
