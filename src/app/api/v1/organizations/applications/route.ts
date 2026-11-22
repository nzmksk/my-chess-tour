import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { enforceRateLimit } from "@/services/rate-limit/limiter";
import { NextRequest, NextResponse } from "next/server";
import { validateApplyRequest } from "./validators";
import { ORGANIZER_AGREEMENT_VERSION } from "@/lib/reference/legal";
import { bankNameForSwift } from "@/lib/reference/malaysian-banks";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { withAuditContext } from "@/services/supabase/audit-context";
import {
  applicationRpcErrorResponse,
  checkUploadedDocuments,
} from "./application-rpc";

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
    return internalErrorResponse(
      "Org applications: failed to list applications",
      error,
    );
  }

  return NextResponse.json({ data: data ?? [] }, { status: 200 });
}

async function handlePost(request: NextRequest): Promise<NextResponse> {
  const claims = await getAuthClaims();

  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const limited = await enforceRateLimit(
    "organizerApplication",
    request,
    claims.id,
  );
  if (limited) return limited;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request body" } },
      { status: 400 },
    );
  }

  // The caller's id, not anything from the body, is what the document paths are
  // checked against.
  const validated = validateApplyRequest(rawBody, claims.id);
  if ("error" in validated) return validated.error;
  const body = validated.data;

  const uploadError = await checkUploadedDocuments(body.documents);
  if (uploadError) return uploadError;

  // One transaction for the organization, its bank account, its documents and
  // its agreement stamp, so a failure partway through leaves nothing behind.
  const { data: org, error: rpcErr } = await supabaseAdmin.rpc(
    "create_organization_application",
    {
      p_created_by: claims.id,
      p_name: body.name,
      p_email: body.email,
      p_entity_type: body.entity_type,
      // Written from the server constant, never from the request — the point of
      // recording a version is that it names the document the platform served.
      p_agreement_version: ORGANIZER_AGREEMENT_VERSION,
      p_bank_code: body.bank_code,
      // Derived from the code, so the stored name can't contradict it.
      p_bank_name: bankNameForSwift(body.bank_code),
      p_account_holder: body.bank_account_holder,
      p_account_number: body.bank_account_number,
      p_documents: body.documents,
      p_description: body.description ?? null,
      p_links: body.links ?? null,
      p_phone: body.phone ?? null,
      p_past_tournament_refs: body.past_tournament_refs ?? null,
      p_registration_number: body.registration_number,
      p_registered_name: body.registered_name,
    },
  );

  if (rpcErr) {
    // The whole transaction has already rolled back, so nothing was created.
    const mapped = applicationRpcErrorResponse(rpcErr);
    if (mapped) return mapped;
    return internalErrorResponse(
      "Org applications: create_organization_application failed",
      rpcErr,
    );
  }

  return NextResponse.json({ data: org }, { status: 201 });
}

export const POST = withAuditContext("org.application.create", handlePost);
