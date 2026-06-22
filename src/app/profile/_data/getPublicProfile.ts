import { supabaseAdmin } from "@/services/supabase/admin";
import type { PublicPlayerProfile } from "@/app/profile/types";

// Fetches the public-facing profile for a given user id. Returns null when the
// user does not exist so callers can render a 404. Only public fields are
// selected — private data (email, date_of_birth, gender, is_oku) is never read.
export async function getPublicProfile(
  userId: string,
): Promise<PublicPlayerProfile | null> {
  const [
    { data: userData, error: userError },
    { data: profileData },
    { count },
  ] = await Promise.all([
    supabaseAdmin
      .from("users")
      .select("id, first_name, last_name, avatar_url")
      .eq("id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("player_profiles")
      .select(
        "nationality, fide_id, fide_rating, title, mcf_id, national_rating",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("registrations")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "confirmed"),
  ]);

  if (userError || !userData) {
    return null;
  }

  return {
    id: userData.id,
    first_name: userData.first_name,
    last_name: userData.last_name,
    avatar_url: userData.avatar_url ?? null,
    nationality: profileData?.nationality ?? null,
    fide_id: profileData?.fide_id ?? null,
    fide_rating: profileData?.fide_rating ?? null,
    title: profileData?.title ?? null,
    mcf_id: profileData?.mcf_id ?? null,
    national_rating: profileData?.national_rating ?? null,
    tournaments_joined: count ?? 0,
  };
}
