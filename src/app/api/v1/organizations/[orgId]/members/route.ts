import { supabaseAdmin } from "@/services/supabase/admin";
import { createClient } from "@/services/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MemberRow = {
  user_id: string;
  joined_at: string;
  users: {
    email: string;
    first_name: string;
    last_name: string;
    avatar_url: string | null;
  };
  roles: {
    name: string;
  };
};

export async function GET(
  _request: NextRequest,
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
      .select("id, approval_status")
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

  if (!memberCount) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Access denied" } },
      { status: 403 },
    );
  }

  const { data: members, error: membersError } = await supabaseAdmin
    .from("organization_memberships")
    .select(
      "user_id, joined_at, users(email, first_name, last_name, avatar_url), roles(name)",
    )
    .eq("organization_id", orgId)
    .order("joined_at", { ascending: true });

  if (membersError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: membersError.message } },
      { status: 500 },
    );
  }

  const rows = (members ?? []) as unknown as MemberRow[];

  return NextResponse.json(
    {
      data: rows.map((m) => ({
        user_id: m.user_id,
        email: m.users.email,
        first_name: m.users.first_name,
        last_name: m.users.last_name,
        avatar_url: m.users.avatar_url,
        role: m.roles.name,
        joined_at: m.joined_at,
      })),
    },
    { status: 200 },
  );
}
