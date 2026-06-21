import { supabaseAdmin } from "@/services/supabase/admin";
import { createClient } from "@/services/supabase/server";
import { hasOrgPermission } from "@/services/supabase/permission";
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
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
      .select("id, approval_status, created_by")
      .eq("id", orgId)
      .is("deleted_at", null)
      .single(),
    supabaseAdmin
      .from("organization_memberships")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("user_id", user.id),
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

  const isCreator = org.created_by === user.id;
  if (!isCreator && !memberCount) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Access denied" } },
      { status: 403 },
    );
  }

  if (!isCreator) {
    const allowed = await hasOrgPermission(user.id, orgId, "org.invite");
    if (!allowed) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Insufficient permissions" } },
        { status: 403 },
      );
    }
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

  const newUserId = inviteData.user.id;

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
