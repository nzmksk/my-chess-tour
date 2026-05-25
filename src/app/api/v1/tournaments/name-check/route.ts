import { supabaseAdmin } from "@/services/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const name = request.nextUrl.searchParams.get("name")?.trim();

  if (!name) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "name is required" } },
      { status: 400 },
    );
  }

  const { count, error } = await supabaseAdmin
    .from("tournaments")
    .select("id", { count: "exact", head: true })
    .ilike("name", name);

  if (error) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ available: count === 0 });
}
