import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { NextRequest, NextResponse } from "next/server";
import { validateApplyRequest } from "./validators";
import { ORGANIZER_AGREEMENT_VERSION } from "@/lib/legal";

export async function GET(_request: NextRequest): Promise<NextResponse> {
  const claims = await getAuthClaims();

  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select(
      "id, name, approval_status, rejection_reason, created_at, reviewed_at",
    )
    .eq("created_by", claims.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: data ?? [] }, { status: 200 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const claims = await getAuthClaims();

  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request body" } },
      { status: 400 },
    );
  }

  const validated = validateApplyRequest(rawBody);
  if ("error" in validated) return validated.error;
  const body = validated.data;

  // Escape ILIKE wildcards so names containing % or _ match literally
  const escapedName = body.name.replace(/[\\%_]/g, "\\$&");
  const { data: nameConflict, error: nameErr } = await supabaseAdmin
    .from("organizations")
    .select("id")
    .ilike("name", escapedName)
    .is("deleted_at", null)
    .maybeSingle();

  if (nameErr) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: nameErr.message } },
      { status: 500 },
    );
  }

  if (nameConflict) {
    return NextResponse.json(
      {
        error: {
          code: "NAME_TAKEN",
          message: "An organization with this name already exists",
        },
      },
      { status: 409 },
    );
  }

  const { data: org, error: insertErr } = await supabaseAdmin
    .from("organizations")
    .insert({
      name: body.name,
      description: body.description ?? null,
      links: body.links ?? null,
      email: body.email,
      phone: body.phone ?? null,
      past_tournament_refs: body.past_tournament_refs ?? null,
      created_by: claims.id,
      // Written from the server constant, never from the request — the point of
      // recording a version is that it names the document the platform served.
      agreement_version: ORGANIZER_AGREEMENT_VERSION,
      agreement_accepted_at: new Date().toISOString(),
      agreement_accepted_by: claims.id,
    })
    .select()
    .single();

  if (insertErr) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: insertErr.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: org }, { status: 201 });
}
