import { getAuthClaims } from "@/services/supabase/permission";
import { supabaseAdmin } from "@/services/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import type { EntryFees } from "@/app/tournaments/types";
import { PAYMENT_TIMEOUT_INTERVAL } from "@/services/chip/chip";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { liveRefund, refundState } from "@/lib/refunds/state";
import { resolveTimeZone } from "@/lib/tournaments/datetime";
import { withAuditContext } from "@/services/supabase/audit-context";
import { listDependents } from "@/services/guardianship/dependents";

const VALID_STATUSES = new Set([
  "pending_payment",
  "failed_payment",
  "cancelled_payment",
  "confirmed",
  "forfeited",
]);
const VALID_SORT = new Set(["start_date", "registered_at", "confirmed_at"]);
const VALID_ORDER = new Set(["asc", "desc"]);

type TournamentRow = {
  id: string;
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  timezone: string;
  venue_name: string;
  venue_state: string;
  format: unknown;
  time_control: unknown;
  entry_fees: EntryFees;
  status: string;
};

type RefundRow = {
  status: string;
  refund_amount_cents: number;
  requested_at: string;
  processed_at: string | null;
  failed_at: string | null;
};

type RegistrationRow = {
  id: string;
  user_id: string;
  fee_tier: string;
  status: string;
  registered_at: string;
  confirmed_at: string | null;
  tournaments: TournamentRow;
  refunds: RefundRow[] | null;
};

async function handleGet(request: NextRequest): Promise<NextResponse> {
  const claims = await getAuthClaims();

  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const { searchParams } = request.nextUrl;

  const statusParam = searchParams.get("status");
  let statuses: string[] | null = null;
  if (statusParam) {
    const requested = statusParam.split(",").map((s) => s.trim());
    const invalid = requested.filter((s) => !VALID_STATUSES.has(s));
    if (invalid.length > 0) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: `Invalid status value(s): ${invalid.join(", ")}`,
          },
        },
        { status: 400 },
      );
    }
    statuses = requested;
  }

  const sort = searchParams.get("sort") ?? "start_date";
  if (!VALID_SORT.has(sort)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: `Invalid sort field: ${sort}`,
        },
      },
      { status: 400 },
    );
  }

  const order = searchParams.get("order") ?? "asc";
  if (!VALID_ORDER.has(order)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: `Invalid order: ${order}`,
        },
      },
      { status: 400 },
    );
  }

  // Terminalize this user's lapsed pending checkouts before listing so they show
  // as expired rather than lingering "pending" (CHIP sends no expiry event).
  // Bulk sweep skips the per-row CHIP cancel — the purchase `due` already makes
  // the link unpayable. Best-effort: never block the listing.
  const dependents = await listDependents(claims.id);
  if (!dependents.ok) {
    return internalErrorResponse(
      "GET /api/v1/me/registrations: dependents lookup failed",
      dependents.error,
    );
  }
  const dependentNames = new Map(
    dependents.data.map((d) => [d.id, `${d.first_name} ${d.last_name}`]),
  );
  const playerIds = [claims.id, ...dependentNames.keys()];

  const expiries = await Promise.all(
    playerIds.map((playerId) =>
      supabaseAdmin.rpc("expire_stale_pending_payments", {
        p_ttl: PAYMENT_TIMEOUT_INTERVAL,
        p_user_id: playerId,
      }),
    ),
  );
  for (const { error: expireErr } of expiries) {
    if (expireErr) {
      console.warn(
        "expire_stale_pending_payments failed (continuing):",
        expireErr,
      );
    }
  }

  let query = supabaseAdmin
    .from("registrations")
    .select(
      `id, user_id, fee_tier, status, registered_at, confirmed_at,
      tournaments!inner (
        id, slug, name, start_date, end_date, timezone, venue_name, venue_state, format, time_control, entry_fees, status
      ),
      refunds (status, refund_amount_cents, requested_at, processed_at, failed_at)`,
    )
    .in("user_id", playerIds)
    // Deterministic base order so equal sort keys (e.g. same start_date) resolve
    // to a stable "most recently registered first" tiebreak. The requested sort
    // is applied in-memory below because `start_date` lives on the joined
    // tournaments table, which PostgREST cannot use to order the parent rows.
    .order("registered_at", { ascending: false });

  if (statuses) {
    query = query.in("status", statuses);
  }

  const { data, error } = await query;

  if (error) {
    return internalErrorResponse(
      "GET /api/v1/me/registrations: error",
      error,
    );
  }

  const rows = (data ?? []) as unknown as RegistrationRow[];

  const formatted = rows.map((row) => {
    const fees = row.tournaments.entry_fees;
    let entry_fee_cents: number | null = null;
    if (fees) {
      if (row.fee_tier === "standard") {
        entry_fee_cents = fees.standard?.amount_cents ?? null;
      } else {
        const tier = fees.additional?.find((t) => t.type === row.fee_tier);
        entry_fee_cents = tier?.amount_cents ?? null;
      }
    }

    // Today only a tournament cancellation creates a refund (#477), so this is
    // how a player follows the money the cancellation email promised (#511).
    const refund = liveRefund(row.refunds);

    const dependentName = dependentNames.get(row.user_id);

    return {
      id: row.id,
      participant: dependentName
        ? { id: row.user_id, name: dependentName }
        : null,
      tournament: {
        id: row.tournaments.id,
        slug: row.tournaments.slug,
        name: row.tournaments.name,
        start_date: row.tournaments.start_date,
        end_date: row.tournaments.end_date,
        // The venue's zone, which the player's Upcoming / Past split is judged
        // in (#619). Resolved here so the client never hands Intl a bad zone.
        timezone: resolveTimeZone(row.tournaments.timezone),
        venue_name: row.tournaments.venue_name,
        venue_state: row.tournaments.venue_state,
        format: row.tournaments.format,
        time_control: row.tournaments.time_control,
        status: row.tournaments.status,
      },
      fee_tier: row.fee_tier,
      entry_fee_cents,
      status: row.status,
      registered_at: row.registered_at,
      confirmed_at: row.confirmed_at,
      refund: refund
        ? {
            state: refundState(refund),
            amount_cents: refund.refund_amount_cents,
            requested_at: refund.requested_at,
            processed_at: refund.processed_at,
          }
        : null,
    };
  });

  const sortKey = (item: (typeof formatted)[number]): string => {
    if (sort === "start_date") return item.tournament.start_date;
    if (sort === "confirmed_at") return item.confirmed_at ?? "";
    return item.registered_at;
  };
  const direction = order === "asc" ? 1 : -1;
  // Stable sort (V8) keeps the DB tiebreak order for equal keys.
  formatted.sort((a, b) => sortKey(a).localeCompare(sortKey(b)) * direction);

  return NextResponse.json(
    { data: formatted, next_cursor: null, has_more: false },
    { status: 200 },
  );
}

export const GET = withAuditContext("payment.expire-stale", handleGet);
