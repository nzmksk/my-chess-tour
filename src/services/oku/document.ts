import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
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

const OKU_MAX_BYTES = 5 * 1024 * 1024;
const OKU_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
] as const;

export interface OkuActor {
  actorId: string;
  subjectId: string;
  route: string;
}

export async function submitOkuDocument(
  request: NextRequest,
  { actorId, subjectId, route }: OkuActor,
): Promise<NextResponse> {
  const self = actorId === subjectId;

  const limited = await enforceRateLimit("okuDocument", request, actorId);
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
  const allowedPrefix = `users/${subjectId}/oku/`;
  if (
    typeof documentPath !== "string" ||
    !documentPath.startsWith(allowedPrefix) ||
    documentPath.includes("..")
  ) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: self
            ? "document_path must point to your own uploaded OKU document"
            : "document_path must point to an OKU document uploaded for this player",
        },
      },
      { status: 400 },
    );
  }

  const consent = await hasSensitiveDataConsent(subjectId, "health");
  if (!consent.ok) {
    return internalErrorResponse(
      `${route}: has_sensitive_data_consent failed`,
      consent.error,
    );
  }
  if (!consent.granted) {
    return NextResponse.json(
      {
        error: {
          code: "CONSENT_REQUIRED",
          message: self
            ? "Please consent to the processing of your health data before submitting your OKU card"
            : "Please record consent to the processing of this player's health data before submitting their OKU card",
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
      user_id: subjectId,
      oku_status: "pending",
      oku_document_path: documentPath,
      oku_reviewed_by: null,
      oku_reviewed_at: null,
      oku_rejection_reason: null,
    },
    { onConflict: "user_id" },
  );
  if (error) {
    return internalErrorResponse(`${route}: error`, error);
  }

  return NextResponse.json(
    { message: "OKU document submitted for verification" },
    { status: 200 },
  );
}

export async function removeOkuDocument({
  actorId,
  subjectId,
  route,
}: OkuActor): Promise<NextResponse> {
  const removeError = await removeAllUnder(OKU_BUCKET, `users/${subjectId}`);
  if (removeError) {
    return internalErrorResponse(
      `${route}: removing OKU documents failed`,
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
    .eq("user_id", subjectId);
  if (profileError) {
    return internalErrorResponse(
      `${route}: resetting OKU status failed`,
      profileError,
    );
  }

  const withdrawn = await withdrawSensitiveDataConsent(
    subjectId,
    "health",
    actorId,
  );
  if (!withdrawn.ok) {
    return internalErrorResponse(
      `${route}: record_sensitive_data_consent failed`,
      withdrawn.error,
    );
  }

  return NextResponse.json(
    { message: "Consent withdrawn and OKU card deleted" },
    { status: 200 },
  );
}
