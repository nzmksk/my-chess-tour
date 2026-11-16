import { cache } from "react";
import { supabaseAdmin } from "@/services/supabase/admin";
import {
  getAuthClaims,
  hasGlobalPermission,
  hasOrgPermission,
} from "@/services/supabase/permission";
import { hasPaidRegistration } from "@/services/payments/paid-registration";
import { loadRoster, rosterDisplayName } from "@/services/registrations/roster";
import { resolveTimeZone } from "@/lib/tournaments/datetime";
import { refundState, type RefundState } from "@/lib/refunds/state";
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

/** A live (non-rejected) refund to one of the tournament's players. */
export interface ManageRefund {
  id: string;
  registration_id: string;
  player_name: string;
  amount_cents: number;
  state: RefundState;
  requested_at: string;
  /** When it cleared; set exactly when state is "refunded". */
  processed_at: string | null;
}

interface RefundRow {
  id: string;
  registration_id: string;
  refund_amount_cents: number;
  requested_at: string;
  processed_at: string | null;
  failed_at: string | null;
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
  /**
   * Refunds to this tournament's players, oldest first, so the organizer can
   * see why its revenue dropped (#511). null when the viewer lacks
   * `refund.manage`, which hides the section rather than showing it empty.
   */
  refunds: ManageRefund[] | null;
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
// registration stats, participant roster, and refunds when `canViewRefunds`).
// Performs NO access check — callers gate first. `orgId`, when given, also
// scopes the read to that organization so an org manager can't reach another
// org's tournament by id.
async function loadTournamentManageData(
  id: string,
  orgId: string | null,
  canViewRefunds: boolean,
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

  const roster = await loadRoster(
    id,
    (tournament.format as { type?: string } | null)?.type,
  );
  if (!roster.ok) {
    return internalError(
      `failed to load ${roster.context} for ${id}`,
      roster.error,
    );
  }

  const participants: ManageParticipant[] = roster.entries.map((entry) => ({
    index: entry.index,
    id: entry.registration_id,
    user_id: entry.user_id,
    name: rosterDisplayName(entry),
    fide_id: entry.fide_id,
    rating: entry.fide_rating,
    fee_tier: entry.fee_tier,
    status: entry.status,
    registered_at: entry.registered_at,
  }));

  const total = participants.length;
  const confirmed = participants.filter((p) => p.status === "confirmed").length;
  const pending = participants.filter(
    (p) => p.status === "pending_payment",
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

  let refunds: ManageRefund[] | null = null;
  if (canViewRefunds) {
    const { data: refundRows, error: refundErr } = await supabaseAdmin
      .from("refunds")
      .select(
        "id, registration_id, refund_amount_cents, requested_at, processed_at, failed_at, registration:registrations!inner(tournament_id)",
      )
      .eq("registration.tournament_id", id)
      .neq("status", "rejected")
      .order("requested_at", { ascending: true });
    if (refundErr) {
      return internalError(`failed to load refunds for ${id}`, refundErr);
    }

    // A refunded registration stays confirmed, so its player is on the roster.
    const names = new Map(participants.map((p) => [p.id, p.name]));
    refunds = ((refundRows ?? []) as unknown as RefundRow[]).map((r) => ({
      id: r.id,
      registration_id: r.registration_id,
      player_name: names.get(r.registration_id) ?? "Player",
      amount_cents: r.refund_amount_cents,
      state: refundState(r),
      requested_at: r.requested_at,
      processed_at: r.processed_at,
    }));
  }

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
      refunds,
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

    // The "Org refund managers can view tournament refunds" RLS policy's gate.
    // Owners and admins hold it today, but the role mapping is data.
    const canViewRefunds = await hasOrgPermission(
      claims.id,
      orgId,
      "refund.manage",
    );

    return loadTournamentManageData(id, orgId, canViewRefunds);
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

    return loadTournamentManageData(id, null, true);
  },
);
