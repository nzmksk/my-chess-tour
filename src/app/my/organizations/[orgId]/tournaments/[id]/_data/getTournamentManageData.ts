import { cache } from "react";
import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { PAYMENT_TIMEOUT_INTERVAL } from "@/services/chip/chip";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ManageParticipant {
  index: number;
  id: string;
  user_id: string;
  name: string;
  fide_id: number | null;
  rating: number | null;
  fee_tier: string;
  status: string;
  registered_at: string;
}

interface TournamentManageData {
  tournament: {
    id: string;
    name: string;
    description: string | null;
    status: "draft" | "published" | "ongoing" | "completed" | "cancelled";
    start_date: string;
    end_date: string;
    registration_deadline: string | null;
    registration_closed_at: string | null;
    venue: { name: string; state: string; address?: string | null };
    format: { type?: string; system?: string; rounds?: number } | null;
    time_control: unknown;
    is_fide_rated: boolean;
    is_mcf_rated: boolean;
    max_participants: number;
    entry_fees: unknown;
    prizes: unknown;
    restrictions: unknown;
  };
  stats: { total: number; confirmed: number; pending: number };
  participants: ManageParticipant[];
  // A cancellation request awaiting platform-admin review, if one is open.
  cancellationPending: boolean;
}

export type TournamentManageResult =
  | { ok: true; data: TournamentManageData }
  | {
      ok: false;
      status: 400 | 401 | 403 | 404 | 500;
      code: string;
      message: string;
    };

// Confirms the signed-in user may manage this org's tournaments (org approved +
// owner/admin membership). Mirrors the API route's permission gate but returns a
// typed result instead of an HTTP response so the page can consume it directly.
async function checkManageAccess(
  orgId: string,
  userId: string,
): Promise<Extract<TournamentManageResult, { ok: false }> | null> {
  const { data: org, error: orgError } = await supabaseAdmin
    .from("organizations")
    .select("id, approval_status")
    .eq("id", orgId)
    .is("deleted_at", null)
    .single();

  if (orgError) {
    if (orgError.code === "PGRST116") {
      return {
        ok: false,
        status: 404,
        code: "NOT_FOUND",
        message: "Organization not found",
      };
    }
    return {
      ok: false,
      status: 500,
      code: "INTERNAL_ERROR",
      message: orgError.message,
    };
  }

  if (org.approval_status !== "approved") {
    return {
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      message: "Organization is not approved",
    };
  }

  const { data: membership, error: memberError } = await supabaseAdmin
    .from("organization_memberships")
    .select("roles!inner(name)")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .single();

  if (memberError || !membership) {
    return {
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      message: "Access denied",
    };
  }

  const roleName = (membership as unknown as { roles: { name: string } }).roles
    ?.name;
  if (roleName !== "owner" && roleName !== "admin") {
    return {
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      message: "Admin or owner role required to update tournaments",
    };
  }

  return null;
}

// Reads everything the tournament management view needs (tournament details,
// registration stats, participant roster) in-process. Wrapped in React cache()
// so the page body and generateMetadata share a single execution per request,
// and so the API GET handler can delegate here without a self-HTTP round trip.
export const getTournamentManageData = cache(
  async (orgId: string, id: string): Promise<TournamentManageResult> => {
    if (!UUID_RE.test(orgId)) {
      return {
        ok: false,
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Invalid organization ID",
      };
    }
    if (!UUID_RE.test(id)) {
      return {
        ok: false,
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Invalid tournament ID",
      };
    }

    const claims = await getAuthClaims();
    if (!claims) {
      return {
        ok: false,
        status: 401,
        code: "UNAUTHORIZED",
        message: "Authentication required",
      };
    }

    const accessError = await checkManageAccess(orgId, claims.id);
    if (accessError) return accessError;

    const { data: tournament, error: tErr } = await supabaseAdmin
      .from("tournaments")
      .select(
        "id, name, description, status, start_date, end_date, registration_deadline, registration_closed_at, venue_name, venue_state, venue_address, format, time_control, is_fide_rated, is_mcf_rated, max_participants, entry_fees, prizes, restrictions",
      )
      .eq("id", id)
      .eq("organization_id", orgId)
      .single();

    if (tErr) {
      if (tErr.code === "PGRST116") {
        return {
          ok: false,
          status: 404,
          code: "NOT_FOUND",
          message: "Tournament not found",
        };
      }
      return {
        ok: false,
        status: 500,
        code: "INTERNAL_ERROR",
        message: tErr.message,
      };
    }

    // Terminalize this tournament's lapsed pending checkouts before listing so
    // the roster's pending_payment rows are genuinely live (CHIP sends no expiry
    // event). Bulk sweep skips the per-row CHIP cancel — the purchase `due`
    // already makes the link unpayable. Best-effort: never block the page.
    const { error: expireErr } = await supabaseAdmin.rpc(
      "expire_stale_pending_payments",
      { p_ttl: PAYMENT_TIMEOUT_INTERVAL, p_tournament_id: id },
    );
    if (expireErr) {
      console.warn("expire_stale_pending_payments failed (continuing):", expireErr);
    }

    const { data: regs, error: regErr } = await supabaseAdmin
      .from("registrations")
      .select("id, user_id, fee_tier, status, registered_at")
      .eq("tournament_id", id)
      .in("status", ["confirmed", "pending_payment"])
      .order("registered_at", { ascending: true });

    if (regErr) {
      return {
        ok: false,
        status: 500,
        code: "INTERNAL_ERROR",
        message: regErr.message,
      };
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
      fide_id: number | null;
      fide_rating: Record<string, number> | null;
      national_rating: number | null;
    };

    let userMap = new Map<string, UserRow>();
    let profileMap = new Map<string, ProfileRow>();

    if (userIds.length > 0) {
      const [{ data: users }, { data: profiles }] = await Promise.all([
        supabaseAdmin
          .from("users")
          .select("id, first_name, last_name")
          .in("id", userIds),
        supabaseAdmin
          .from("player_profiles")
          .select("user_id, fide_id, fide_rating, national_rating")
          .in("user_id", userIds),
      ]);

      userMap = new Map(((users as UserRow[]) ?? []).map((u) => [u.id, u]));
      profileMap = new Map(
        ((profiles as ProfileRow[]) ?? []).map((p) => [p.user_id, p]),
      );
    }

    const formatType =
      (tournament.format as { type?: string } | null)?.type ?? "";

    const participants: ManageParticipant[] = registrations.map((reg, idx) => {
      const u = userMap.get(reg.user_id);
      const p = profileMap.get(reg.user_id);

      let rating: number | null = null;
      if (p?.fide_rating) {
        const r = p.fide_rating;
        if (formatType === "blitz") {
          rating = r.blitz ?? r.rapid ?? r.standard ?? null;
        } else if (formatType === "rapid") {
          rating = r.rapid ?? r.standard ?? null;
        } else {
          rating = r.standard ?? null;
        }
      }

      return {
        index: idx + 1,
        id: reg.id,
        user_id: reg.user_id,
        name: u ? `${u.first_name} ${u.last_name}` : "Unknown",
        fide_id: p?.fide_id ?? null,
        rating,
        fee_tier: reg.fee_tier,
        status: reg.status,
        registered_at: reg.registered_at,
      };
    });

    const total = registrations.length;
    const confirmed = registrations.filter(
      (r) => r.status === "confirmed",
    ).length;
    const pending = registrations.filter(
      (r) => r.status === "pending_payment",
    ).length;

    // Is there a cancellation request awaiting admin review? Drives the manage
    // page's "cancellation pending" banner (and hides the cancel action).
    const { count: pendingCancellationCount } = await supabaseAdmin
      .from("tournament_cancellation_requests")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", id)
      .eq("status", "pending");

    return {
      ok: true,
      data: {
        tournament: {
          id: tournament.id,
          name: tournament.name,
          description: tournament.description ?? null,
          status: tournament.status,
          start_date: tournament.start_date,
          end_date: tournament.end_date,
          registration_deadline: tournament.registration_deadline,
          registration_closed_at: tournament.registration_closed_at ?? null,
          venue: {
            name: tournament.venue_name,
            state: tournament.venue_state,
            address: tournament.venue_address,
          },
          format: tournament.format,
          time_control: tournament.time_control,
          is_fide_rated: tournament.is_fide_rated,
          is_mcf_rated: tournament.is_mcf_rated,
          max_participants: tournament.max_participants,
          entry_fees: tournament.entry_fees,
          prizes: tournament.prizes ?? null,
          restrictions: tournament.restrictions ?? null,
        },
        stats: { total, confirmed, pending },
        participants,
        cancellationPending: (pendingCancellationCount ?? 0) > 0,
      },
    };
  },
);
