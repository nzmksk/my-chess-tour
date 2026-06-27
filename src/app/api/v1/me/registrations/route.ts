import { getAuthClaims } from "@/services/supabase/permission";
import { supabaseAdmin } from "@/services/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import type { EntryFees } from "@/app/tournaments/types";

const VALID_STATUSES = new Set([
  "pending_payment",
  "failed_payment",
  "cancelled_payment",
  "confirmed",
  "forfeited",
]);
const VALID_SORT = new Set(["registered_at", "confirmed_at"]);
const VALID_ORDER = new Set(["asc", "desc"]);

type TournamentRow = {
  id: string;
  name: string;
  start_date: string;
  venue_name: string;
  venue_state: string;
  format: unknown;
  time_control: unknown;
  entry_fees: EntryFees;
  status: string;
};

type RegistrationRow = {
  id: string;
  fee_tier: string;
  status: string;
  registered_at: string;
  confirmed_at: string | null;
  tournaments: TournamentRow;
};

export async function GET(request: NextRequest): Promise<NextResponse> {
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

  const sort = searchParams.get("sort") ?? "registered_at";
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

  const order = searchParams.get("order") ?? "desc";
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

  let query = supabaseAdmin
    .from("registrations")
    .select(
      `id, fee_tier, status, registered_at, confirmed_at,
      tournaments!inner (
        id, name, start_date, venue_name, venue_state, format, time_control, entry_fees, status
      )`,
    )
    .eq("user_id", claims.id)
    .order(sort, { ascending: order === "asc" });

  if (statuses) {
    query = query.in("status", statuses);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 },
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

    return {
      id: row.id,
      tournament: {
        id: row.tournaments.id,
        name: row.tournaments.name,
        start_date: row.tournaments.start_date,
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
    };
  });

  return NextResponse.json(
    { data: formatted, next_cursor: null, has_more: false },
    { status: 200 },
  );
}
