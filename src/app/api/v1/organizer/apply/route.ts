import { supabaseAdmin } from "@/services/supabase/admin";
import { createClient } from "@/services/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { validateApplyRequest } from "./validators";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
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

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from("organizations")
    .select("id, approval_status")
    .eq("created_by", user.id)
    .in("approval_status", ["pending", "approved"])
    .maybeSingle();

  if (existingErr) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: existingErr.message } },
      { status: 500 },
    );
  }

  if (existing) {
    return NextResponse.json(
      {
        error: {
          code: "ALREADY_APPLIED",
          message:
            existing.approval_status === "approved"
              ? "You already have an approved organization"
              : "You already have a pending application",
        },
      },
      { status: 409 },
    );
  }

  // TODO: Create an owner membership for the applicant's organization
  const { data: org, error: insertErr } = await supabaseAdmin
    .from("organizations")
    .insert({
      name: body.name,
      description: body.description ?? null,
      links: body.links ?? null,
      email: body.email,
      phone: body.phone ?? null,
      past_tournament_refs: body.past_tournament_refs ?? null,
      created_by: user.id,
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
