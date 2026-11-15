import { cache } from "react";
import { supabaseAdmin } from "@/services/supabase/admin";
import {
  getAuthClaims,
  hasGlobalPermission,
} from "@/services/supabase/permission";
import { PAYMENT_TIMEOUT_INTERVAL } from "@/services/chip/chip";
import { hasPaidRegistration } from "@/services/payments/paid-registration";
import { resolveTimeZone } from "@/lib/tournaments/datetime";
import {
  INTERNAL_ERROR_MESSAGE,
  logInternalError,
} from "@/lib/http/internal-error";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ManageParticipant {
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
    venue: {
      name: string;
      state: string;
      address?: string | null;
      /** ISO 3166-1 alpha-2 — decides the payout rails, not the clock. */
      country: string;
    };
    /** IANA timezone of the venue — the zone its dates and times are read in. */
    timezone: string;
    format: { type?: string; system?: string; rounds?: number } | null;
    time_control: unknown;
    is_fide_rated: boolean;
    is_mcf_rated: boolean;
    max_participants: number;
    entry_fees: unknown;
    prizes: unknown;
    restrictions: unknown;
    /** The organization that runs the tournament. */
    organization: { id: string; name: string | null };
    /** The nominated payout recipient, if any. See nominate_payout_beneficiary. */
    beneficiary: {
      organization_id: string;
      name: string | null;
      accepted: boolean;
    } | null;
  };
  stats: { total: number; confirmed: number; pending: number };
  /**
   * Whether a registration payment has settled, which puts the tournament in
   * the edit policy's "paid" stage. Not the same as `stats.confirmed > 0`: a
   * paid registration that was later forfeited still counts here.
   */
  hasPaidRegistration: boolean;
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

type TournamentManageFailure = Extract<TournamentManageResult, { ok: false }>;

// Both the manage page and the API route surface `message`, so a database
// error is logged here and replaced with the generic text.
function internalError(
  context: string,
  cause: unknown,
): TournamentManageFailure {
  logInternalError(`Tournament manage data: ${context}`, cause);
  return {
    ok: false,
    status: 500,
    code: "INTERNAL_ERROR",
    message: INTERNAL_ERROR_MESSAGE,
  };
}

// Confirms the signed-in user may manage this org's tournaments (org approved +
// owner/admin membership). Mirrors the API route's permission gate but returns a
// typed result instead of an HTTP response so the page can consume it directly.
async function checkManageAccess(
  orgId: string,
  userId: string,
): Promise<TournamentManageFailure | null> {
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
    return internalError(`failed to load organization ${orgId}`, orgError);
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

const INVALID_TOURNAMENT_ID: TournamentManageFailure = {
  ok: false,
  status: 400,
  code: "VALIDATION_ERROR",
  message: "Invalid tournament ID",
};

const UNAUTHENTICATED: TournamentManageFailure = {
  ok: false,
  status: 401,
  code: "UNAUTHORIZED",
  message: "Authentication required",
};

// Reads everything the tournament management view needs (tournament details,
// registration stats, participant roster). Performs NO access check — callers
// gate first. `orgId`, when given, also scopes the read to that organization so
// an org manager can't reach another org's tournament by id.
async function loadTournamentManageData(
  id: string,
  orgId: string | null,
): Promise<TournamentManageResult> {
  let query = supabaseAdmin
    .from("tournaments")
    .select(
      "id, name, description, status, start_date, end_date, registration_deadline, registration_closed_at, venue_name, venue_state, venue_address, venue_country, timezone, format, time_control, is_fide_rated, is_mcf_rated, max_participants, entry_fees, prizes, restrictions, organization_id, organization:organizations!organization_id(name), beneficiary_organization_id, beneficiary_accepted_at, beneficiary:organizations!beneficiary_organization_id(name)",
    )
    .eq("id", id);
  if (orgId) query = query.eq("organization_id", orgId);

  const { data: tournament, error: tErr } = await query.single();

  if (tErr) {
    if (tErr.code === "PGRST116") {
      return {
        ok: false,
        status: 404,
        code: "NOT_FOUND",
        message: "Tournament not found",
      };
    }
    return internalError(`failed to load tournament ${id}`, tErr);
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
    console.warn(
      "expire_stale_pending_payments failed (continuing):",
      expireErr,
    );
  }

  const { data: regs, error: regErr } = await supabaseAdmin
    .from("registrations")
    .select("id, user_id, fee_tier, status, registered_at")
    .eq("tournament_id", id)
    .in("status", ["confirmed", "pending_payment"])
    .order("registered_at", { ascending: true });

  if (regErr) {
    return internalError(`failed to load registrations for ${id}`, regErr);
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

  // Same helper the PATCH route uses, so the edit wizard locks exactly what
  // the API would refuse.
  const paid = await hasPaidRegistration(id);
  if (!paid.ok) {
    return internalError(`failed to check payments for ${id}`, paid.error);
  }

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
          country: tournament.venue_country,
        },
        timezone: resolveTimeZone(tournament.timezone),
        format: tournament.format,
        time_control: tournament.time_control,
        is_fide_rated: tournament.is_fide_rated,
        is_mcf_rated: tournament.is_mcf_rated,
        max_participants: tournament.max_participants,
        entry_fees: tournament.entry_fees,
        prizes: tournament.prizes ?? null,
        restrictions: tournament.restrictions ?? null,
        organization: {
          id: tournament.organization_id,
          name:
            (tournament.organization as unknown as { name: string } | null)
              ?.name ?? null,
        },
        beneficiary: tournament.beneficiary_organization_id
          ? {
              organization_id: tournament.beneficiary_organization_id,
              name:
                (tournament.beneficiary as unknown as { name: string } | null)
                  ?.name ?? null,
              accepted: tournament.beneficiary_accepted_at !== null,
            }
          : null,
      },
      stats: { total, confirmed, pending },
      hasPaidRegistration: paid.paid,
      participants,
      cancellationPending: (pendingCancellationCount ?? 0) > 0,
    },
  };
}

// The organizer's management view: the caller must be an owner/admin of an
// approved `orgId`, and the tournament must belong to it. Wrapped in React
// cache() so the page body and generateMetadata share a single execution per
// request, and so the API GET handler can delegate here without a self-HTTP
// round trip.
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
    if (!UUID_RE.test(id)) return INVALID_TOURNAMENT_ID;

    const claims = await getAuthClaims();
    if (!claims) return UNAUTHENTICATED;

    const accessError = await checkManageAccess(orgId, claims.id);
    if (accessError) return accessError;

    return loadTournamentManageData(id, orgId);
  },
);

// The platform admin's view of the same data: any tournament, in any status
// (draft, published, cancelled), regardless of which organization runs it.
// Gated on the global `platform.manage` permission.
export const getAdminTournamentManageData = cache(
  async (id: string): Promise<TournamentManageResult> => {
    if (!UUID_RE.test(id)) return INVALID_TOURNAMENT_ID;

    const claims = await getAuthClaims();
    if (!claims) return UNAUTHENTICATED;

    if (!(await hasGlobalPermission(claims.id, "platform.manage"))) {
      return {
        ok: false,
        status: 403,
        code: "FORBIDDEN",
        message: "Admin access required",
      };
    }

    return loadTournamentManageData(id, null);
  },
);
