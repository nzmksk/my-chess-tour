import { supabaseAdmin } from "@/services/supabase/admin";
import type { PublicPlayerProfile } from "@/app/profile/types";

// Whole-year age from a YYYY-MM-DD date of birth, or null when absent/invalid.
// Computed server-side so the raw date_of_birth never leaves this module.
function computeAge(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const birth = new Date(dob + "T00:00:00Z");
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())
  ) {
    age--;
  }
  return age >= 0 ? age : null;
}

// Fetches the public-facing profile for a given user id. Returns null when the
// user does not exist so callers can render a 404. The email is never read;
// date_of_birth is read only to derive age and is never returned. Gender is
// always public. Age and OKU status are gated behind the owner's show_age /
// show_oku toggles.
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
        "gender, nationality, fide_id, fide_rating, title, mcf_id, national_rating, date_of_birth, is_oku, show_age, show_oku",
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
    gender: profileData?.gender ?? null,
    nationality: profileData?.nationality ?? null,
    age: profileData?.show_age ? computeAge(profileData.date_of_birth) : null,
    is_oku: profileData?.show_oku ? (profileData.is_oku ?? false) : false,
    fide_id: profileData?.fide_id ?? null,
    fide_rating: profileData?.fide_rating ?? null,
    title: profileData?.title ?? null,
    mcf_id: profileData?.mcf_id ?? null,
    national_rating: profileData?.national_rating ?? null,
    tournaments_joined: count ?? 0,
  };
}
