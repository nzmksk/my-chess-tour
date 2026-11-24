import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { internalErrorResponse } from "@/lib/http/internal-error";

const MAX_NAME_LENGTH = 255;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const claims = await getAuthClaims();
  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const name = request.nextUrl.searchParams.get("name")?.trim() ?? "";
  if (name === "" || name.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: `name must be 1 to ${MAX_NAME_LENGTH} characters`,
        },
      },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin.rpc("assert_org_name_available", {
    p_name: name,
  });

  if (error) {
    if (error.message?.includes("NAME_TAKEN")) {
      return NextResponse.json(
        { data: { name, available: false } },
        { status: 200 },
      );
    }
    return internalErrorResponse(
      "GET /api/v1/organizations/name-availability: error",
      error,
    );
  }

  return NextResponse.json(
    { data: { name, available: true } },
    { status: 200 },
  );
}
