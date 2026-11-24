import { NextRequest, NextResponse } from "next/server";
import { getAuthClaims } from "@/services/supabase/permission";
import {
  removeOkuDocument,
  submitOkuDocument,
} from "@/services/oku/document";
import { withAuditContext } from "@/services/supabase/audit-context";

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
    { status: 401 },
  );
}

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
async function handlePost(request: NextRequest): Promise<NextResponse> {
  const claims = await getAuthClaims();
  if (!claims) return unauthorized();
  return submitOkuDocument(request, {
    actorId: claims.id,
    subjectId: claims.id,
    route: "POST /api/v1/profile/oku",
  });
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
async function handleDelete(): Promise<NextResponse> {
  const claims = await getAuthClaims();
  if (!claims) return unauthorized();
  return removeOkuDocument({
    actorId: claims.id,
    subjectId: claims.id,
    route: "DELETE /api/v1/profile/oku",
  });
}

export const DELETE = withAuditContext("profile.oku.remove", handleDelete);
export const POST = withAuditContext("profile.oku.submit", handlePost);
