import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import {
  assertUploadedObject,
  removeAllUnder,
} from "@/services/supabase/storage";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { enforceRateLimit } from "@/services/rate-limit/limiter";
import {
  hasSensitiveDataConsent,
  withdrawSensitiveDataConsent,
} from "@/services/consent/sensitive-data";

const OKU_BUCKET = "oku-documents";

// Must match the uploader in OkuVerificationCard.
const OKU_MAX_BYTES = 5 * 1024 * 1024;
const OKU_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
] as const;

// Records an uploaded OKU card and moves the player into review. The document
// itself was already uploaded to the private oku-documents bucket by the client
// (RLS restricts writes to the user's own folder); here we validate the path
// belongs to this user, confirm there is a sane file behind it, store it, and
// set oku_status = 'pending'. Admin review then flips it to 'verified' /
// 'rejected'.
//
// The card is health data, held only with the player's separate consent
// (#451). The storage policy already refused the upload without it; this
// re-checks before the card is put in front of a reviewer, so a grant
// withdrawn between upload and registration still stops it here.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const claims = await getAuthClaims();

  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  // Each submission puts a document in front of an admin for review.
  const limited = await enforceRateLimit("okuDocument", request, claims.id);
  if (limited) return limited;

  let body: { document_path?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const documentPath = body.document_path;
  const allowedPrefix = `users/${claims.id}/oku/`;
  if (
    typeof documentPath !== "string" ||
    !documentPath.startsWith(allowedPrefix) ||
    documentPath.includes("..")
  ) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "document_path must point to your own uploaded OKU document",
        },
      },
      { status: 400 },
    );
  }

  // The prefix check above proves the path is in this user's folder; it does
  // not prove anything is there, or that what is there is a 5MB image rather
  // than a 500MB blob. MAX_BYTES in the uploader is a UX affordance — the file
  // never passes through this route. The bucket's file_size_limit and
  // allowed_mime_types (005_bucket_policies.sql) reject bad uploads at Storage;
  // this re-checks the object actually registered, and keep the two in sync.
  const consent = await hasSensitiveDataConsent(claims.id, "health");
  if (!consent.ok) {
    return internalErrorResponse(
      "POST /api/v1/profile/oku: has_sensitive_data_consent failed",
      consent.error,
    );
  }
  if (!consent.granted) {
    return NextResponse.json(
      {
        error: {
          code: "CONSENT_REQUIRED",
          message:
            "Please consent to the processing of your health data before submitting your OKU card",
        },
      },
      { status: 409 },
    );
  }

  const check = await assertUploadedObject(OKU_BUCKET, documentPath, {
    maxBytes: OKU_MAX_BYTES,
    mimeTypes: OKU_MIME_TYPES,
  });

  if (!check.ok) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: check.reason } },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin.from("player_profiles").upsert(
    {
      user_id: claims.id,
      oku_status: "pending",
      oku_document_path: documentPath,
      oku_reviewed_by: null,
      oku_reviewed_at: null,
      oku_rejection_reason: null,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    return internalErrorResponse(
      "POST /api/v1/profile/oku: error",
      error,
    );
  }

  return NextResponse.json(
    { message: "OKU document submitted for verification" },
    { status: 200 },
  );
}

// Withdraws the player's consent to the processing of their health data
// (#451), which means the data goes: everything they have put in the bucket,
// their OKU
// status, and the review that went with it. A verified player drops back to
// 'none' and loses OKU fee tiers for future registrations; entries already paid
// for are not touched.
//
// "Everything" is the whole users/{id}/ prefix, not one listing of
// users/{id}/oku/. A resubmission after rejection leaves the earlier card
// behind, and the upload policy checks only that prefix, so a client can put
// any number of files at any depth under it, all health data.
// removeAllUnder pages and recurses until nothing is left.
//
// The order makes every partial failure safe to retry. Files first, then the
// profile, then the withdrawal record: a withdrawal is never recorded while the
// card still exists, and until the profile is reset the player still sees the
// withdraw button and can try again. The service role removes the files
// because clients have no DELETE policy on the bucket (005_bucket_policies.sql).
export async function DELETE(): Promise<NextResponse> {
  const claims = await getAuthClaims();

  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const removeError = await removeAllUnder(OKU_BUCKET, `users/${claims.id}`);
  if (removeError) {
    return internalErrorResponse(
      "DELETE /api/v1/profile/oku: removing OKU documents failed",
      removeError,
    );
  }

  const { error: profileError } = await supabaseAdmin
    .from("player_profiles")
    .update({
      oku_status: "none",
      oku_document_path: null,
      oku_reviewed_by: null,
      oku_reviewed_at: null,
      oku_rejection_reason: null,
    })
    .eq("user_id", claims.id);
  if (profileError) {
    return internalErrorResponse(
      "DELETE /api/v1/profile/oku: resetting OKU status failed",
      profileError,
    );
  }

  const withdrawn = await withdrawSensitiveDataConsent(claims.id, "health");
  if (!withdrawn.ok) {
    return internalErrorResponse(
      "DELETE /api/v1/profile/oku: record_sensitive_data_consent failed",
      withdrawn.error,
    );
  }

  return NextResponse.json(
    { message: "Consent withdrawn and OKU card deleted" },
    { status: 200 },
  );
}
