import { supabaseAdmin } from "@/services/supabase/admin";
import {
  hasOrgPermission,
  getAuthClaims,
} from "@/services/supabase/permission";
import { NextRequest, NextResponse } from "next/server";
import { ORGANIZER_AGREEMENT_VERSION } from "@/lib/legal";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Records this organization's acceptance of the current Organizer Agreement.
 *
 * Bumping ORGANIZER_AGREEMENT_VERSION is how a new document is published: every
 * organization whose stored version is older is then behind the re-acceptance
 * gate, and the payout functions refuse to move money until it matches. This
 * route is the only way out of that state.
 *
 * The version written is the server's constant. The request body carries a
 * declaration of acceptance and nothing else — a client-supplied version would
 * let an organization claim to have accepted a document it was never shown.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const { orgId } = await params;

  if (!UUID_RE.test(orgId)) {
    return NextResponse.json(
      {
        error: { code: "VALIDATION_ERROR", message: "Invalid organization ID" },
      },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request body" } },
      { status: 400 },
    );
  }

  if (
    !body ||
    typeof body !== "object" ||
    (body as Record<string, unknown>).agreement_accepted !== true
  ) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "You must accept the Organizer Agreement",
        },
      },
      { status: 400 },
    );
  }

  const claims = await getAuthClaims();

  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const [
    { data: org, error: orgError },
    { count: memberCount, error: memberError },
  ] = await Promise.all([
    supabaseAdmin
      .from("organizations")
      .select("id, agreement_version, agreement_accepted_at")
      .eq("id", orgId)
      .is("deleted_at", null)
      .single(),
    supabaseAdmin
      .from("organization_memberships")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("user_id", claims.id),
  ]);

  if (orgError) {
    if (orgError.code === "PGRST116") {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Organization not found" } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: orgError.message } },
      { status: 500 },
    );
  }

  if (memberError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: memberError.message } },
      { status: 500 },
    );
  }

  if (!memberCount) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Access denied" } },
      { status: 403 },
    );
  }

  // Deliberately no approval_status check, unlike the other org routes: a
  // pending or rejected organization must still be able to accept a new version
  // of the agreement, otherwise a version bump would strand it permanently.
  const allowed = await hasOrgPermission(claims.id, orgId, "org.manage");
  if (!allowed) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Insufficient permissions" } },
      { status: 403 },
    );
  }

  // Already on the current version — accepting again would only move the
  // timestamp, and the timestamp is evidence of when this version was accepted.
  if (org.agreement_version === ORGANIZER_AGREEMENT_VERSION) {
    return NextResponse.json(
      {
        data: {
          agreement_version: org.agreement_version,
          agreement_accepted_at: org.agreement_accepted_at,
        },
      },
      { status: 200 },
    );
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("organizations")
    .update({
      agreement_version: ORGANIZER_AGREEMENT_VERSION,
      agreement_accepted_at: new Date().toISOString(),
      agreement_accepted_by: claims.id,
    })
    .eq("id", orgId)
    .select("agreement_version, agreement_accepted_at")
    .single();

  if (updateError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: updateError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: updated }, { status: 200 });
}
