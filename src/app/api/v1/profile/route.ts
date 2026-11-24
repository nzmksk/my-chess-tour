import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { enforceRateLimit } from "@/services/rate-limit/limiter";
import { NextRequest, NextResponse } from "next/server";
import {
  PROFILE_FIELDS_SELECT,
  resolveNewFideId,
  validateProfileFields,
  type ExistingProfileFields,
} from "@/services/profile/profile-fields";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { withAuditContext } from "@/services/supabase/audit-context";
import {
  UNDER_18_SELF_ACCOUNT_MESSAGE,
  isUnderAdultAge,
} from "@/lib/auth/adult-age";

export async function GET(): Promise<NextResponse> {
  const claims = await getAuthClaims();

  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const [
    { data: userData, error: userError },
    { data: profileData },
    { data: bankData },
  ] = await Promise.all([
      supabaseAdmin
        .from("users")
        .select("id, first_name, last_name, email, avatar_url")
        .eq("id", claims.id)
        .single(),
      supabaseAdmin
        .from("player_profiles")
        .select(
          "date_of_birth, gender, nationality, oku_status, oku_rejection_reason, fide_id, fide_rating, fide_rating_synced_at, fide_name_verified, fide_verified_name, title, mcf_id, national_rating",
        )
        .eq("user_id", claims.id)
        .maybeSingle(),
      // The prize destination (#523): only the active row.
      supabaseAdmin
        .from("player_bank_accounts")
        .select(
          "bank_name, bank_code, account_holder, account_number, status, rejection_reason, bank_holder_name",
        )
        .eq("user_id", claims.id)
        .eq("is_active", true)
        .maybeSingle(),
    ]);

  if (userError || !userData) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "User not found" } },
      { status: 404 },
    );
  }

  return NextResponse.json({
    data: {
      id: userData.id,
      email: userData.email,
      first_name: userData.first_name,
      last_name: userData.last_name,
      avatar_url: userData.avatar_url ?? null,
      date_of_birth: profileData?.date_of_birth ?? null,
      gender: profileData?.gender ?? null,
      nationality: profileData?.nationality ?? null,
      oku_status: profileData?.oku_status ?? "none",
      oku_rejection_reason: profileData?.oku_rejection_reason ?? null,
      fide_id: profileData?.fide_id ?? null,
      fide_rating: profileData?.fide_rating ?? null,
      fide_rating_synced_at: profileData?.fide_rating_synced_at ?? null,
      fide_name_verified: profileData?.fide_name_verified ?? null,
      fide_verified_name: profileData?.fide_verified_name ?? null,
      title: profileData?.title ?? null,
      mcf_id: profileData?.mcf_id ?? null,
      national_rating: profileData?.national_rating ?? null,
      bank_name: bankData?.bank_name ?? null,
      bank_code: bankData?.bank_code ?? null,
      bank_account_holder: bankData?.account_holder ?? null,
      // Never expose the full account number; only the last 4 digits for display.
      bank_account_number_last4: bankData?.account_number
        ? bankData.account_number.slice(-4)
        : null,
      bank_account_status: bankData?.status ?? null,
      bank_account_rejection_reason: bankData?.rejection_reason ?? null,
      bank_holder_name: bankData?.bank_holder_name ?? null,
    },
  });
}

async function handlePatch(request: NextRequest): Promise<NextResponse> {
  const claims = await getAuthClaims();

  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const limited = await enforceRateLimit("profileSave", request, claims.id);
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  // Existing values, used to enforce set-once / never-editable rules so a
  // crafted request cannot bypass the UI lock. A missing row means all-null.
  const { data: existing } = await supabaseAdmin
    .from("player_profiles")
    .select(PROFILE_FIELDS_SELECT)
    .eq("user_id", claims.id)
    .maybeSingle<ExistingProfileFields>();

  const { update, errors } = validateProfileFields(body, existing);

  // avatar_url lives on the users table, not player_profiles. Only accept a URL
  // that points at this user's own folder in the public avatars bucket, so a
  // crafted request can't store an arbitrary external URL on the profile.
  let avatarUpdate: { value: string | null } | null = null;
  if ("avatar_url" in body) {
    const allowedPrefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/users/${claims.id}/`;
    if (body.avatar_url === null) {
      avatarUpdate = { value: null };
    } else if (
      typeof body.avatar_url === "string" &&
      body.avatar_url.startsWith(allowedPrefix)
    ) {
      avatarUpdate = { value: body.avatar_url };
    } else {
      errors.push("avatar_url must be a valid uploaded avatar URL or null");
    }
  }

  if (errors.length > 0) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: errors.join("; "),
        },
      },
      { status: 400 },
    );
  }

  if (
    update.date_of_birth != null &&
    update.date_of_birth !== existing?.date_of_birth &&
    isUnderAdultAge(update.date_of_birth)
  ) {
    const { data: account, error: accountError } = await supabaseAdmin
      .from("users")
      .select("account_type")
      .eq("id", claims.id)
      .single();
    if (accountError) {
      return internalErrorResponse(
        "PATCH /api/v1/profile: account type lookup failed",
        accountError,
      );
    }
    if (account?.account_type !== "managed") {
      return NextResponse.json(
        {
          error: {
            code: "UNDER_18",
            message: UNDER_18_SELF_ACCOUNT_MESSAGE,
          },
        },
        { status: 422 },
      );
    }
  }

  if (Object.keys(update).length === 0 && avatarUpdate === null) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "No valid fields provided",
        },
      },
      { status: 400 },
    );
  }

  let fideFields = {};
  if (update.fide_id != null && update.fide_id !== existing?.fide_id) {
    const fide = await resolveNewFideId(
      request,
      claims.id,
      update.fide_id,
      async () => {
        const { data } = await supabaseAdmin
          .from("users")
          .select("first_name, last_name")
          .eq("id", claims.id)
          .single();
        return data;
      },
    );
    if (!fide.ok) return fide.response;
    fideFields = fide.fields;
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabaseAdmin
      .from("player_profiles")
      .upsert(
        { user_id: claims.id, ...update, ...fideFields },
        { onConflict: "user_id" },
      );

    if (error) {
      return internalErrorResponse(
        "PATCH /api/v1/profile: error",
        error,
      );
    }
  }

  if (avatarUpdate !== null) {
    // Grab the current avatar so we can delete its storage object after the
    // record is repointed; only files in this user's own avatars folder.
    const { data: existingUser } = await supabaseAdmin
      .from("users")
      .select("avatar_url")
      .eq("id", claims.id)
      .single();

    const { error } = await supabaseAdmin
      .from("users")
      .update({ avatar_url: avatarUpdate.value })
      .eq("id", claims.id);

    if (error) {
      return internalErrorResponse(
        "PATCH /api/v1/profile: error",
        error,
      );
    }

    const oldUrl = existingUser?.avatar_url as string | null | undefined;
    const publicPrefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/`;
    if (
      oldUrl &&
      oldUrl !== avatarUpdate.value &&
      oldUrl.startsWith(publicPrefix)
    ) {
      const oldPath = oldUrl.slice(publicPrefix.length);
      // Best-effort cleanup: a failed delete leaves an orphaned file but must
      // not fail the request, since the profile was already updated.
      const { error: removeError } = await supabaseAdmin.storage
        .from("avatars")
        .remove([oldPath]);
      if (removeError) {
        console.error(
          "Failed to delete previous avatar for user ID:",
          claims.id,
          removeError,
        );
      }
    }
  }

  return NextResponse.json({ success: true }, { status: 200 });
}

export const PATCH = withAuditContext("profile.update", handlePatch);
