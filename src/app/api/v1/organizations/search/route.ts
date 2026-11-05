import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { NextRequest, NextResponse } from "next/server";

const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 10;

// %, _ and \ are wildcards to ILIKE, so typed literally they must be escaped.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Approved organizations by name, for picking a payout beneficiary. Name and id only.
 * Whether an organization can actually receive a payout is decided at nomination,
 * and is not revealed here.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const claims = await getAuthClaims();
  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ data: [] }, { status: 200 });
  }

  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("id, name")
    .eq("approval_status", "approved")
    .is("deleted_at", null)
    .ilike("name", `%${escapeLike(query)}%`)
    .order("name")
    .limit(MAX_RESULTS);

  if (error) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: data ?? [] }, { status: 200 });
}
