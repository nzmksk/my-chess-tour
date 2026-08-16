import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { assertUploadedObject } from "@/services/supabase/storage";
import { NextRequest, NextResponse } from "next/server";
import { validateApplyRequest } from "./validators";
import { ORGANIZER_AGREEMENT_VERSION } from "@/lib/legal";
import { bankNameForSwift } from "@/lib/malaysian-banks";

// Must match the uploader in ApplyForm. Enforced here as well as there because
// the browser check is a UX affordance, not a control — the file goes straight
// to storage and never passes through this route.
const DOCUMENT_BUCKET = "organization-documents";
const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
const DOCUMENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
] as const;

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

  // The caller's id, not anything from the body, is what the document paths are
  // checked against.
  const validated = validateApplyRequest(rawBody, claims.id);
  if ("error" in validated) return validated.error;
  const body = validated.data;

  // Confirm each claimed object actually exists and is within limits before its
  // path is recorded. Sequential rather than parallel: an applicant submits a
  // handful of documents, and the first failure is the one worth reporting.
  for (const doc of body.documents) {
    const check = await assertUploadedObject(DOCUMENT_BUCKET, doc.storage_path, {
      maxBytes: DOCUMENT_MAX_BYTES,
      mimeTypes: DOCUMENT_MIME_TYPES,
    });
    if (!check.ok) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: `${doc.original_filename ?? "Document"}: ${check.reason}`,
          },
        },
        { status: 400 },
      );
    }
  }

  // One transaction for the organization, its bank account, its documents and
  // its agreement stamp. The previous read-then-insert lost the name-uniqueness
  // race, and — once bank details and documents joined the payload — a failure
  // partway through would have left the organization created and its name taken
  // with no way for the applicant to retry.
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
    },
  );

  if (rpcErr) {
    // Sentinel prefixes raised by the RPC (003_functions_triggers.sql). The
    // whole transaction has already rolled back, so the name is still free.
    if (rpcErr.message.includes("NAME_TAKEN")) {
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
    if (rpcErr.message.includes("BANK_ACCOUNT_IN_USE")) {
      return NextResponse.json(
        {
          error: {
            code: "BANK_ACCOUNT_IN_USE",
            message:
              "This bank account is already the payout destination for another organization",
          },
        },
        { status: 409 },
      );
    }
    if (rpcErr.message.includes("ENTITY_DOCS_REQUIRED")) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message:
              "The verification documents do not match the entity type selected",
          },
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: rpcErr.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: org }, { status: 201 });
}
