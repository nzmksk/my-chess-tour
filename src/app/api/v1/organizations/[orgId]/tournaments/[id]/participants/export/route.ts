import { supabaseAdmin } from "@/services/supabase/admin";
import { loadRoster, type RosterEntry } from "@/services/registrations/roster";
import { authorizeTournamentManager } from "../../_lib/authorize";
import { toCsv, toXlsx, type Row } from "@/lib/export/spreadsheet";
import { slugify } from "@/lib/tournaments/slugs";
import {
  resolveTimeZone,
  timeZoneAbbreviation,
  toLocalDateTimeInput,
} from "@/lib/tournaments/datetime";
import { resolveCountry } from "@/lib/reference/countries";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { NextRequest, NextResponse } from "next/server";

const FORMATS = {
  csv: { contentType: "text/csv; charset=utf-8", extension: "csv" },
  xlsx: {
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: "xlsx",
  },
} as const;

type ExportFormat = keyof typeof FORMATS;

const GENDER_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
};

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  pending_payment: "Pending payment",
};

function toTitleCase(str: string): string {
  return str.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The roster as spreadsheet rows, header first. Columns are what pairing
 * software (Swiss-Manager and the like) imports, plus the registration's own
 * state, and nothing beyond what the privacy policy's "Sharing of Data"
 * section says organisers receive.
 * Times are wall-clock in the venue's timezone, as on the manage page.
 */
function rosterRows(entries: RosterEntry[], timeZone: string): Row[] {
  const header: Row = [
    "#",
    "Title",
    "First name",
    "Last name",
    "Gender",
    "Date of birth",
    "Nationality",
    "FIDE ID",
    "FIDE rating",
    "MCF ID",
    "National rating",
    "Fee tier",
    "Status",
    `Registered (${timeZoneAbbreviation(timeZone)})`,
  ];

  return [
    header,
    ...entries.map(
      (e): Row => [
        e.index,
        e.title,
        e.first_name ?? "",
        e.last_name ?? "",
        e.gender ? GENDER_LABELS[e.gender] : null,
        e.date_of_birth,
        // Stored as the dropdown's country name; older rows may hold a code.
        resolveCountry(e.nationality)?.name ?? e.nationality,
        e.fide_id,
        e.fide_rating,
        e.mcf_id,
        e.national_rating,
        toTitleCase(e.fee_tier),
        STATUS_LABELS[e.status] ?? toTitleCase(e.status),
        toLocalDateTimeInput(e.registered_at, timeZone).replace("T", " "),
      ],
    ),
  ];
}

/**
 * Downloads a tournament's roster — the same confirmed and pending-payment
 * registrations the manage page lists — as CSV (default) or Excel, for seeding
 * pairing software. `?format=csv|xlsx`.
 *
 * Owner/admin only, like the manage page itself. Never cached: it is a list of
 * people, and pending rows come and go by the minute.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> },
): Promise<NextResponse> {
  const { orgId, id } = await params;

  const formatParam = request.nextUrl.searchParams.get("format") ?? "csv";
  if (!Object.hasOwn(FORMATS, formatParam)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: 'format must be "csv" or "xlsx"',
        },
      },
      { status: 400 },
    );
  }
  const format = formatParam as ExportFormat;

  const auth = await authorizeTournamentManager(
    orgId,
    id,
    "export participants",
  );
  if (!auth.ok) return auth.response;

  const { data: tournament, error: tErr } = await supabaseAdmin
    .from("tournaments")
    .select("id, name, slug, timezone, format")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();

  if (tErr) {
    if (tErr.code === "PGRST116") {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Tournament not found" } },
        { status: 404 },
      );
    }
    return internalErrorResponse(
      "GET /api/v1/organizations/[orgId]/tournaments/[id]/participants/export: tErr",
      tErr,
    );
  }

  const roster = await loadRoster(
    id,
    (tournament.format as { type?: string } | null)?.type,
  );
  if (!roster.ok) {
    return internalErrorResponse(
      `GET /api/v1/organizations/[orgId]/tournaments/[id]/participants/export: ${roster.context}`,
      roster.error,
    );
  }

  const rows = rosterRows(roster.entries, resolveTimeZone(tournament.timezone));
  const { contentType, extension } = FORMATS[format];
  // slugify yields [a-z0-9-] only, so the name is safe in the header as-is.
  const filename = `${slugify(tournament.slug ?? tournament.name)}-participants.${extension}`;
  const body = format === "xlsx" ? toXlsx(rows, "Participants") : toCsv(rows);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
