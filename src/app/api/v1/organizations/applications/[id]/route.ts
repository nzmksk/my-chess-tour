import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { enforceRateLimit } from "@/services/rate-limit/limiter";
import { NextRequest, NextResponse } from "next/server";
import { validateResubmitRequest } from "../validators";
import { ORGANIZER_AGREEMENT_VERSION } from "@/lib/reference/legal";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { afterResponse } from "@/lib/http/after-response";
import { withAuditContext } from "@/services/supabase/audit-context";
import {
  DOCUMENT_BUCKET,
  applicationRpcErrorResponse,
  checkUploadedDocuments,
} from "../application-rpc";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PUT /api/v1/organizations/applications/[id]
 *
 * The applicant amends their rejected application and sends it back for review
 * (#582). Everything happens in resubmit_organization_application, in one
 * transaction: the fields are replaced, the payout account is kept or
 * replaced, documents are kept, dropped or added, the Organizer Agreement is
 * accepted again at the current version, and the application returns to
 * pending. Only the caller's own rejected application can be amended.
 */
async function handlePut(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const claims = await getAuthClaims();
  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Application not found" } },
      { status: 404 },
    );
  }

  // The same budget as applying: a resubmission is reviewed like a new one.
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

  // The caller's id, not anything from the body, is what new document paths
  // are checked against.
  const validated = validateResubmitRequest(rawBody, claims.id);
  if ("error" in validated) return validated.error;
  const body = validated.data;

  const uploadError = await checkUploadedDocuments(body.new_documents);
  if (uploadError) return uploadError;

  const { data, error } = await supabaseAdmin.rpc(
    "resubmit_organization_application",
    {
      p_org_id: id,
      // The RPC refuses an application this user didn't create.
      p_user_id: claims.id,
      p_name: body.name,
      p_email: body.email,
      p_entity_type: body.entity_type,
      // From the server constant, never the request: the stamp names the
      // document the platform served.
      p_agreement_version: ORGANIZER_AGREEMENT_VERSION,
      p_keep_document_ids: body.keep_document_ids,
      p_new_documents: body.new_documents,
      p_description: body.description,
      p_links: body.links,
      p_phone: body.phone,
      p_past_tournament_refs: body.past_tournament_refs,
      p_registration_number: body.registration_number,
      p_registered_name: body.registered_name,
    },
  );

  if (error) {
    const mapped = applicationRpcErrorResponse(error);
    if (mapped) return mapped;
    return internalErrorResponse(
      "Org applications: resubmit_organization_application failed",
      error,
    );
  }

  // Delete the files of the documents the applicant dropped. The rows are
  // already gone, so a failure only leaves an unreferenced file behind; it is
  // logged and never fails the resubmission. SQL can't delete storage objects
  // on Supabase, which is why this happens here.
  const removed: string[] = data?.removed_storage_paths ?? [];
  if (removed.length > 0) {
    afterResponse(async () => {
      const { error: removeError } = await supabaseAdmin.storage
        .from(DOCUMENT_BUCKET)
        .remove(removed);
      if (removeError) {
        console.error(
          "Org applications: failed to delete dropped documents",
          { organizationId: id, count: removed.length },
          removeError,
        );
      }
    });
  }

  // Storage paths stay server-side.
  const application = { ...(data ?? {}) };
  delete application.removed_storage_paths;
  return NextResponse.json({ data: application }, { status: 200 });
}

export const PUT = withAuditContext("org.application.resubmit", handlePut);
