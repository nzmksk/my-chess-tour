import { supabaseAdmin } from "@/services/supabase/admin";
import {
  hasOrgPermission,
  getAuthClaims,
} from "@/services/supabase/permission";
import { lookupAppUserId } from "@/services/supabase/identity";
import { NextRequest, NextResponse } from "next/server";
import { validateInviteRequest } from "./validators";

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

  const { data: existingUser } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("email", email)
    .is("deleted_at", null)
    .maybeSingle();

  const invitedAt = new Date().toISOString();

  if (existingUser) {
    const { count: existingCount, error: existingCountError } =
      await supabaseAdmin
        .from("organization_memberships")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("user_id", existingUser.id);

    if (existingCountError) {
      return NextResponse.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: existingCountError.message,
          },
        },
        { status: 500 },
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
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: insertError.message } },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        data: {
          id: existingUser.id,
          email,
          role,
          status: "active",
          invited_at: invitedAt,
        },
      },
      { status: 201 },
    );
  }

  const { data: inviteData, error: inviteError } =
    await supabaseAdmin.auth.admin.inviteUserByEmail(email);

  if (inviteError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: inviteError.message } },
      { status: 500 },
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
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: insertError.message } },
      { status: 500 },
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
