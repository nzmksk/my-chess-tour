import { supabaseAdmin } from "@/services/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/http/internal-error";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const name = request.nextUrl.searchParams.get("name")?.trim();
  const excludeId = request.nextUrl.searchParams.get("excludeId")?.trim();

  if (!name) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "name is required" } },
      { status: 400 },
    );
  }

  let query = supabaseAdmin
    .from("tournaments")
    .select("id", { count: "exact", head: true })
    .ilike("name", name);

  if (excludeId && UUID_RE.test(excludeId)) {
    query = query.neq("id", excludeId);
  }

  const { count, error } = await query;

  if (error) {
    return internalErrorResponse(
      "GET /api/v1/tournaments/name-check: error",
      error,
    );
  }

  return NextResponse.json({ available: count === 0 });
}
