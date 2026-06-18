import { supabaseAdmin } from "@/services/supabase/admin";
import { createClient } from "@/services/supabase/server";
import { hasOrgPermission } from "@/services/supabase/permission";
import { NextRequest, NextResponse } from "next/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_ROLES = ["admin", "member"] as const;
type MemberRole = (typeof VALID_ROLES)[number];

async function resolveOrgAccess(
  orgId: string,
  userId: string,
): Promise<NextResponse | { isCreator: boolean }> {
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
      .eq("user_id", userId),
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

  const isCreator = org.created_by === userId;
  if (!isCreator && !memberCount) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Access denied" } },
      { status: 403 },
    );
  }

  return { isCreator };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> },
): Promise<NextResponse> {
  const { orgId, id } = await params;

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

  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid member ID",
        },
      },
      { status: 400 },
    );
  }

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

  if (user.id === id) {
    return NextResponse.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Cannot change your own role",
        },
      },
      { status: 403 },
    );
  }

  const accessResult = await resolveOrgAccess(orgId, user.id);
  if (accessResult instanceof NextResponse) return accessResult;
  const { isCreator } = accessResult;

  if (!isCreator) {
    const allowed = await hasOrgPermission(user.id, orgId, "org.manage");
    if (!allowed) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Insufficient permissions" } },
        { status: 403 },
      );
    }
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

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request body" } },
      { status: 400 },
    );
  }

  const b = body as Record<string, unknown>;
  if (!b.role || !VALID_ROLES.includes(b.role as MemberRole)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Role must be 'admin' or 'member'",
        },
      },
      { status: 400 },
    );
  }

  const role = b.role as MemberRole;

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from("organization_memberships")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("user_id", id)
    .single();

  if (membershipError) {
    if (membershipError.code === "PGRST116") {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Member not found" } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: membershipError.message } },
      { status: 500 },
    );
  }

  if (!membership) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Member not found" } },
      { status: 404 },
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

  const { error: updateError } = await supabaseAdmin
    .from("organization_memberships")
    .update({ role_id: roleData.id })
    .eq("organization_id", orgId)
    .eq("user_id", id);

  if (updateError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: updateError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { data: { user_id: id, role } },
    { status: 200 },
  );
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> },
): Promise<NextResponse> {
  const { orgId, id } = await params;

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

  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid member ID",
        },
      },
      { status: 400 },
    );
  }

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

  if (user.id === id) {
    return NextResponse.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Cannot remove yourself from the organization",
        },
      },
      { status: 403 },
    );
  }

  const accessResult = await resolveOrgAccess(orgId, user.id);
  if (accessResult instanceof NextResponse) return accessResult;
  const { isCreator } = accessResult;

  if (!isCreator) {
    const allowed = await hasOrgPermission(user.id, orgId, "org.manage");
    if (!allowed) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Insufficient permissions" } },
        { status: 403 },
      );
    }
  }

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from("organization_memberships")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("user_id", id)
    .single();

  if (membershipError) {
    if (membershipError.code === "PGRST116") {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Member not found" } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: membershipError.message } },
      { status: 500 },
    );
  }

  if (!membership) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Member not found" } },
      { status: 404 },
    );
  }

  const { error: deleteError } = await supabaseAdmin
    .from("organization_memberships")
    .delete()
    .eq("organization_id", orgId)
    .eq("user_id", id);

  if (deleteError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: deleteError.message } },
      { status: 500 },
    );
  }

  return new NextResponse(null, { status: 204 });
}
