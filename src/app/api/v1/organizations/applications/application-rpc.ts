import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { assertUploadedObject } from "@/services/supabase/storage";

/**
 * Shared by POST /api/v1/organizations/applications (apply) and
 * PUT /api/v1/organizations/applications/[id] (amend and resubmit, #582), so a
 * first submission and a resubmission check uploads and report failures the
 * same way.
 */

// Must match the uploader in ApplyForm. Enforced here as well as there because
// the browser check is a UX affordance, not a control — the file goes straight
// to storage and never passes through these routes.
export const DOCUMENT_BUCKET = "organization-documents";
const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
const DOCUMENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
] as const;

/**
 * Confirms each claimed object actually exists and is within limits before its
 * path is recorded. Sequential rather than parallel: an applicant submits a
 * handful of documents, and the first failure is the one worth reporting.
 * Returns the 400 to send, or null when every document checks out.
 */
export async function checkUploadedDocuments(
  documents: { storage_path: string; original_filename: string | null }[],
): Promise<NextResponse | null> {
  for (const doc of documents) {
    const check = await assertUploadedObject(
      DOCUMENT_BUCKET,
      doc.storage_path,
      {
        maxBytes: DOCUMENT_MAX_BYTES,
        mimeTypes: DOCUMENT_MIME_TYPES,
      },
    );
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
  return null;
}

function conflict(code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status: 409 });
}

/**
 * Maps the sentinel prefixes the application RPCs raise
 * (supabase/migrations/20261120165346_amend_rejected_org_application.sql) to
 * responses. The whole transaction has already rolled back. Returns null for
 * an error that isn't one of them, which the caller treats as a 500.
 */
export function applicationRpcErrorResponse(
  error: Pick<PostgrestError, "message" | "code">,
): NextResponse | null {
  const message = error.message ?? "";

  if (message.includes("APPLICATION_NOT_FOUND")) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Application not found" } },
      { status: 404 },
    );
  }
  if (message.includes("APPLICATION_NOT_REJECTED")) {
    return conflict(
      "APPLICATION_NOT_REJECTED",
      "Only a rejected application can be amended",
    );
  }
  if (message.includes("NAME_TAKEN")) {
    return conflict(
      "NAME_TAKEN",
      "An approved organization already uses this name",
    );
  }
  if (message.includes("BANK_ACCOUNT_IN_USE")) {
    return conflict(
      "BANK_ACCOUNT_IN_USE",
      "This bank account is already the payout destination for another organization",
    );
  }
  if (message.includes("BANK_ACCOUNT_REQUIRED")) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message:
            "This application has no bank account to keep. Please enter one.",
        },
      },
      { status: 400 },
    );
  }
  if (message.includes("TOO_MANY_DOCUMENTS")) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "At most 10 documents can be submitted",
        },
      },
      { status: 400 },
    );
  }
  if (message.includes("ENTITY_DOCS_REQUIRED")) {
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
  return null;
}
