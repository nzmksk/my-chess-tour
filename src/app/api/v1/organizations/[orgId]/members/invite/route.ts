import { supabaseAdmin } from "@/services/supabase/admin";
import {
  hasOrgPermission,
  getAuthClaims,
} from "@/services/supabase/permission";
import { lookupAppUserId } from "@/services/supabase/identity";
import { notifyMemberInvited } from "@/services/organizations/notify";
import { NextRequest, NextResponse } from "next/server";
import { validateInviteRequest } from "./validators";
import { internalErrorResponse } from "@/lib/http/internal-error";

// Inviting emails the new member, and email templates are read from disk.
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const { orgId } = await params;

  if (!UUID_RE.test(orgId)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid organization ID",
        },
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

  const validation = validateInviteRequest(body);
  if ("error" in validation) {
    return validation.error;
  }
  const { email, role } = validation.data;

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
      .select("id, approval_status")
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
    return internalErrorResponse(
      "POST /api/v1/organizations/[orgId]/members/invite: orgError",
      orgError,
    );
  }

  if (memberError) {
    return internalErrorResponse(
      "POST /api/v1/organizations/[orgId]/members/invite: memberError",
      memberError,
    );
  }

  if (org.approval_status !== "approved") {
    return NextResponse.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Organization is not approved",
        },
      },
      { status: 403 },
    );
  }

  if (!memberCount) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Access denied" } },
      { status: 403 },
    );
  }

  const allowed = await hasOrgPermission(claims.id, orgId, "org.invite");
  if (!allowed) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Insufficient permissions" } },
      { status: 403 },
    );
  }

  const { data: roleData, error: roleError } = await supabaseAdmin
    .from("roles")
    .select("id")
    .eq("name", role)
    .single();

  if (roleError || !roleData) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Role not found" } },
      { status: 500 },
    );
  }

  const { data: existingUser, error: existingUserError } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("email", email)
    .is("deleted_at", null)
    .maybeSingle();

  // A failed lookup must not read as "no such user": falling through to the
  // invite would send an existing member down the new-account path, and the
  // email_exists that GoTrue then returns would be misreported as drift below.
  if (existingUserError) {
    return internalErrorResponse(
      "POST /api/v1/organizations/[orgId]/members/invite: existingUserError",
      existingUserError,
    );
  }

  const invitedAt = new Date().toISOString();

  if (existingUser) {
    const { count: existingCount, error: existingCountError } =
      await supabaseAdmin
        .from("organization_memberships")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("user_id", existingUser.id);

    if (existingCountError) {
      return internalErrorResponse(
        "POST /api/v1/organizations/[orgId]/members/invite: existingCountError",
        existingCountError,
      );
    }

    if (existingCount && existingCount > 0) {
      return NextResponse.json(
        {
          error: {
            code: "CONFLICT",
            message: "User is already a member of this organization",
          },
        },
        { status: 409 },
      );
    }

    const { error: insertError } = await supabaseAdmin
      .from("organization_memberships")
      .insert({
        organization_id: orgId,
        user_id: existingUser.id,
        role_id: roleData.id,
      });

    if (insertError) {
      return internalErrorResponse(
        "POST /api/v1/organizations/[orgId]/members/invite: insertError",
        insertError,
      );
    }

    // They are a member as of the insert above; the email only tells them so.
    const emailSent = await notifyMemberInvited({
      orgId,
      inviterId: claims.id,
      memberId: existingUser.id,
      role,
    });

    return NextResponse.json(
      {
        data: {
          id: existingUser.id,
          email,
          role,
          status: "active",
          invited_at: invitedAt,
          email_sent: emailSent,
        },
      },
      { status: 201 },
    );
  }

  const { data: inviteData, error: inviteError } =
    await supabaseAdmin.auth.admin.inviteUserByEmail(email);

  if (inviteError) {
    // The lookup above succeeded and found no live users record, yet Auth
    // already holds an account for this email: the account and the users table
    // have drifted apart (e.g. a schema reset that kept auth.users). There is
    // no users.id to attach a membership to, and GoTrue's own wording ("already
    // been registered") reads to the inviter as if the invite should have
    // worked — so say what is actually wrong instead of surfacing it as a 500.
    if (inviteError.code === "email_exists") {
      console.error(
        "Invite target has an auth account but no linked users record",
        inviteError,
      );
      return NextResponse.json(
        {
          error: {
            code: "ACCOUNT_UNLINKED",
            message:
              "This email belongs to an account that is missing its profile, so it can't be added yet. Please contact support.",
          },
        },
        { status: 409 },
      );
    }
    return internalErrorResponse(
      "POST /api/v1/organizations/[orgId]/members/invite: inviteError",
      inviteError,
    );
  }

  // inviteUserByEmail returns an AUTH id. organization_memberships.user_id is a
  // public.users.id, so it has to be resolved through the link. The record is
  // created synchronously by the on_auth_user_created trigger, so it exists by
  // the time the invite call returns.
  const newUserId = await lookupAppUserId(inviteData.user.id);

  if (!newUserId) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Invited account was created without a user record",
        },
      },
      { status: 500 },
    );
  }

  const { error: insertError } = await supabaseAdmin
    .from("organization_memberships")
    .insert({
      organization_id: orgId,
      user_id: newUserId,
      role_id: roleData.id,
    });

  if (insertError) {
    return internalErrorResponse(
      "POST /api/v1/organizations/[orgId]/members/invite: insertError",
      insertError,
    );
  }

  return NextResponse.json(
    {
      data: {
        id: newUserId,
        email,
        role,
        status: "pending",
        invited_at: invitedAt,
      },
    },
    { status: 201 },
  );
}
