import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { assertUploadedObject } from "@/services/supabase/storage";

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
export async function POST(request: NextRequest): Promise<NextResponse> {
  const claims = await getAuthClaims();

  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

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
  // never passes through this route, so this is the only place the limit can
  // actually be enforced.
  const check = await assertUploadedObject("oku-documents", documentPath, {
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
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { message: "OKU document submitted for verification" },
    { status: 200 },
  );
}
