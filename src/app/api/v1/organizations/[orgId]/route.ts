import { supabaseAdmin } from "@/services/supabase/admin";
import {
  hasOrgPermission,
  getAuthClaims,
} from "@/services/supabase/permission";
import { NextRequest, NextResponse } from "next/server";
import { validateOrgUpdate } from "./validators";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AVATAR_PUBLIC_PREFIX = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/`;

/**
 * Edit an organization's public profile — the write half of the settings page.
 *
 * Until this existed there was no way to change an organization after it was
 * created: no avatar, no description, no contact correction. The RLS policy
 * "Org managers can update org" has always allowed it; nothing called it.
 *
 * Requires `org.manage` (owner only, per the role matrix). Deliberately no
 * approval_status gate: a pending or rejected organization must still be able
 * to correct the details it is being judged on.
 */
export async function PATCH(
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

  const claims = await getAuthClaims();

  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request body" } },
      { status: 400 },
    );
  }

  const validated = validateOrgUpdate(rawBody, orgId);
  if ("error" in validated) return validated.error;
  const update = validated.data;

  const { data: existing, error: readError } = await supabaseAdmin
    .from("organizations")
    .select("id, avatar_url")
    .eq("id", orgId)
    .is("deleted_at", null)
    .single();

  if (readError || !existing) {
    if (readError && readError.code !== "PGRST116") {
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: readError.message } },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Organization not found" } },
      { status: 404 },
    );
  }

  const allowed = await hasOrgPermission(claims.id, orgId, "org.manage");
  if (!allowed) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Insufficient permissions" } },
      { status: 403 },
    );
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("organizations")
    .update(update)
    .eq("id", orgId)
    .select(
      "id, name, description, links, email, phone, past_tournament_refs, avatar_url",
    )
    .single();

  if (updateError) {
    // idx_organizations_name_active — case-insensitive unique among active orgs.
    if (updateError.code === "23505") {
      return NextResponse.json(
        {
          error: {
            code: "NAME_TAKEN",
            message: "An organization with this name already exists",
          },
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: updateError.message } },
      { status: 500 },
    );
  }

  // Best-effort cleanup of the replaced avatar: an orphaned object is cheaper
  // than failing a request whose update already committed. Mirrors the player
  // avatar path in /api/v1/profile.
  const oldUrl = existing.avatar_url as string | null;
  if (
    "avatar_url" in update &&
    oldUrl &&
    oldUrl !== update.avatar_url &&
    oldUrl.startsWith(AVATAR_PUBLIC_PREFIX)
  ) {
    const { error: removeError } = await supabaseAdmin.storage
      .from("avatars")
      .remove([oldUrl.slice(AVATAR_PUBLIC_PREFIX.length)]);
    if (removeError) {
      console.error(
        "Failed to delete previous avatar for organization ID:",
        orgId,
        removeError,
      );
    }
  }

  return NextResponse.json({ data: updated }, { status: 200 });
}
