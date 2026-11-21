import { supabaseAdmin } from "@/services/supabase/admin";
import { PAYMENT_TIMEOUT_INTERVAL } from "@/services/chip/chip";
import { runWithAuditContext } from "@/services/supabase/audit-context";

export interface RosterEntry {
  index: number;
  registration_id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  gender: "male" | "female" | null;
  date_of_birth: string | null;
  nationality: string | null;
  is_oku: boolean;
  fide_id: number | null;
  fide_rating: number | null;
  mcf_id: number | null;
  national_rating: number | null;
  fee_tier: string;
  status: string;
  registered_at: string;
}

export type RosterResult =
  | { ok: true; entries: RosterEntry[] }
  | { ok: false; context: string; error: unknown };

const ROSTER_STATUSES = ["confirmed", "pending_payment"] as const;

export function pickFideRating(
  ratings: Record<string, number> | null | undefined,
  formatType: string | null | undefined,
): number | null {
  if (!ratings) return null;
  if (formatType === "blitz") {
    return ratings.blitz ?? ratings.rapid ?? ratings.standard ?? null;
  }
  if (formatType === "rapid") {
    return ratings.rapid ?? ratings.standard ?? null;
  }
  return ratings.standard ?? null;
}

export async function loadRoster(
  tournamentId: string,
  formatType: string | null | undefined,
): Promise<RosterResult> {
  const { error: expireErr } = await runWithAuditContext(
    "payment.expire-stale",
    () =>
      supabaseAdmin.rpc("expire_stale_pending_payments", {
        p_ttl: PAYMENT_TIMEOUT_INTERVAL,
        p_tournament_id: tournamentId,
      }),
  );
  if (expireErr) {
    console.warn(
      "expire_stale_pending_payments failed (continuing):",
      expireErr,
    );
  }

  const { data: regs, error: regErr } = await supabaseAdmin
    .from("registrations")
    .select("id, user_id, fee_tier, status, registered_at")
    .eq("tournament_id", tournamentId)
    .in("status", [...ROSTER_STATUSES])
    .order("registered_at", { ascending: true });

  if (regErr) {
    return { ok: false, context: "registrations", error: regErr };
  }

  const registrations = (regs ?? []) as Array<{
    id: string;
    user_id: string;
    fee_tier: string;
    status: string;
    registered_at: string;
  }>;

  const userIds = registrations.map((r) => r.user_id).filter(Boolean);

  type UserRow = { id: string; first_name: string; last_name: string };
  type ProfileRow = {
    user_id: string;
    title: string | null;
    gender: "male" | "female" | null;
    date_of_birth: string | null;
    nationality: string | null;
    oku_status: string | null;
    fide_id: number | null;
    fide_rating: Record<string, number> | null;
    mcf_id: number | null;
    national_rating: number | null;
  };

  let userMap = new Map<string, UserRow>();
  let profileMap = new Map<string, ProfileRow>();

  if (userIds.length > 0) {
    const [usersRes, profilesRes] = await Promise.all([
      supabaseAdmin
        .from("users")
        .select("id, first_name, last_name")
        .in("id", userIds),
      supabaseAdmin
        .from("player_profiles")
        .select(
          "user_id, title, gender, date_of_birth, nationality, oku_status, fide_id, fide_rating, mcf_id, national_rating",
        )
        .in("user_id", userIds),
    ]);

    if (usersRes.error) {
      return { ok: false, context: "users", error: usersRes.error };
    }
    if (profilesRes.error) {
      return {
        ok: false,
        context: "player_profiles",
        error: profilesRes.error,
      };
    }

    userMap = new Map(
      ((usersRes.data as UserRow[]) ?? []).map((u) => [u.id, u]),
    );
    profileMap = new Map(
      ((profilesRes.data as ProfileRow[]) ?? []).map((p) => [p.user_id, p]),
    );
  }

  const entries = registrations.map((reg, idx): RosterEntry => {
    const u = userMap.get(reg.user_id);
    const p = profileMap.get(reg.user_id);
    return {
      index: idx + 1,
      registration_id: reg.id,
      user_id: reg.user_id,
      first_name: u?.first_name ?? null,
      last_name: u?.last_name ?? null,
      title: p?.title ?? null,
      gender: p?.gender ?? null,
      date_of_birth: p?.date_of_birth ?? null,
      nationality: p?.nationality ?? null,
      is_oku: p?.oku_status === "verified",
      fide_id: p?.fide_id ?? null,
      fide_rating: pickFideRating(p?.fide_rating, formatType),
      mcf_id: p?.mcf_id ?? null,
      national_rating: p?.national_rating ?? null,
      fee_tier: reg.fee_tier,
      status: reg.status,
      registered_at: reg.registered_at,
    };
  });

  return { ok: true, entries };
}

export function rosterDisplayName(entry: RosterEntry): string {
  const name = [entry.first_name, entry.last_name]
    .filter((part) => part && part.trim())
    .join(" ");
  return name || "Unknown";
}
