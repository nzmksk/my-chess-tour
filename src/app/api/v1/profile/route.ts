import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { NextRequest, NextResponse } from "next/server";
import type { Gender, UpdateProfilePayload } from "@/app/profile/types";
import {
  buildFideProfileUpdate,
  fetchFidePlayer,
  type FidePlayer,
} from "@/services/fide/fide";

const VALID_GENDERS = new Set<string>(["male", "female"]);

export async function GET(): Promise<NextResponse> {
  const claims = await getAuthClaims();

  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const [{ data: userData, error: userError }, { data: profileData }] =
    await Promise.all([
      supabaseAdmin
        .from("users")
        .select("id, first_name, last_name, email, avatar_url")
        .eq("id", claims.id)
        .single(),
      supabaseAdmin
        .from("player_profiles")
        .select(
          "date_of_birth, gender, nationality, oku_status, oku_rejection_reason, fide_id, fide_rating, fide_rating_synced_at, fide_name_verified, fide_verified_name, title, mcf_id, national_rating, bank_name, bank_account_holder, bank_account_number",
        )
        .eq("user_id", claims.id)
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
      bank_name: profileData?.bank_name ?? null,
      bank_account_holder: profileData?.bank_account_holder ?? null,
      // Never expose the full account number; only the last 4 digits for display.
      bank_account_number_last4: profileData?.bank_account_number
        ? profileData.bank_account_number.slice(-4)
        : null,
    },
  });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const claims = await getAuthClaims();

  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

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
    .select(
      "date_of_birth, gender, nationality, fide_id, mcf_id, title, national_rating",
    )
    .eq("user_id", claims.id)
    .maybeSingle();

  const errors: string[] = [];
  const update: UpdateProfilePayload = {};

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

  if ("gender" in body) {
    if (body.gender === null) {
      update.gender = null;
    } else if (
      typeof body.gender === "string" &&
      VALID_GENDERS.has(body.gender)
    ) {
      update.gender = body.gender as Gender;
    } else {
      errors.push("gender must be 'male', 'female', or null");
    }
    if (
      update.gender !== undefined &&
      existing?.gender != null &&
      update.gender !== existing.gender
    ) {
      errors.push("gender can only be set once; contact support to change");
    }
  }

  // Chess title is never user-editable; reject any attempt to change it.
  if ("title" in body && body.title !== (existing?.title ?? null)) {
    errors.push("title cannot be edited; contact support to change");
  }

  if ("fide_id" in body) {
    if (body.fide_id === null) {
      update.fide_id = null;
    } else if (
      typeof body.fide_id === "number" &&
      Number.isInteger(body.fide_id) &&
      body.fide_id > 0 &&
      body.fide_id <= 2147483647
    ) {
      update.fide_id = body.fide_id;
    } else {
      errors.push(
        "fide_id must be a positive integer no greater than 2147483647 or null",
      );
    }
    if (
      update.fide_id !== undefined &&
      existing?.fide_id != null &&
      update.fide_id !== existing.fide_id
    ) {
      errors.push("fide_id can only be set once; contact support to change");
    }
  }

  if ("mcf_id" in body) {
    if (body.mcf_id === null) {
      update.mcf_id = null;
    } else if (
      typeof body.mcf_id === "number" &&
      Number.isInteger(body.mcf_id) &&
      body.mcf_id > 0 &&
      body.mcf_id <= 2147483647
    ) {
      update.mcf_id = body.mcf_id;
    } else {
      errors.push(
        "mcf_id must be a positive integer no greater than 2147483647 or null",
      );
    }
    if (
      update.mcf_id !== undefined &&
      existing?.mcf_id != null &&
      update.mcf_id !== existing.mcf_id
    ) {
      errors.push("mcf_id can only be set once; contact support to change");
    }
  }

  // National rating is never user-editable; reject any attempt to change it.
  if (
    "national_rating" in body &&
    body.national_rating !== (existing?.national_rating ?? null)
  ) {
    errors.push("national_rating cannot be edited; contact support to change");
  }

  if ("date_of_birth" in body) {
    if (body.date_of_birth === null) {
      update.date_of_birth = null;
    } else if (
      typeof body.date_of_birth === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(body.date_of_birth)
    ) {
      const [y, m, d] = body.date_of_birth.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (
        dt.getUTCFullYear() === y &&
        dt.getUTCMonth() + 1 === m &&
        dt.getUTCDate() === d
      ) {
        update.date_of_birth = body.date_of_birth;
      } else {
        errors.push(
          "date_of_birth must be a valid calendar date (YYYY-MM-DD) or null",
        );
      }
    } else {
      errors.push(
        "date_of_birth must be a valid calendar date (YYYY-MM-DD) or null",
      );
    }
    if (
      update.date_of_birth !== undefined &&
      existing?.date_of_birth != null &&
      update.date_of_birth !== existing.date_of_birth
    ) {
      errors.push(
        "date_of_birth can only be set once; contact support to change",
      );
    }
  }

  if ("nationality" in body) {
    if (body.nationality === null) {
      update.nationality = null;
    } else if (
      typeof body.nationality === "string" &&
      body.nationality.trim()
    ) {
      update.nationality = body.nationality.trim();
    } else {
      errors.push("nationality must be a non-empty string or null");
    }
    if (
      update.nationality !== undefined &&
      existing?.nationality != null &&
      update.nationality !== existing.nationality
    ) {
      errors.push(
        "nationality can only be set once; contact support to change",
      );
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

  // When a FIDE ID is set for the first time, fetch the player's ratings, title
  // and validate their name against the FIDE profile. A nonexistent ID is
  // rejected so a typo isn't stored in this set-once field; if FIDE is
  // unreachable we still save the ID and let the monthly sync backfill ratings.
  let fideFields: Partial<ReturnType<typeof buildFideProfileUpdate>> = {};
  if (update.fide_id != null && update.fide_id !== existing?.fide_id) {
    let player: FidePlayer | null = null;
    let reachable = true;
    try {
      player = await fetchFidePlayer(update.fide_id);
    } catch (error) {
      reachable = false;
      console.error(
        `FIDE lookup unavailable for user ${claims.id} (fide_id ${update.fide_id}):`,
        error,
      );
    }

    if (reachable && player === null) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: `FIDE ID ${update.fide_id} was not found on FIDE. Please check the number.`,
          },
        },
        { status: 400 },
      );
    }

    if (player) {
      const { data: nameRow } = await supabaseAdmin
        .from("users")
        .select("first_name, last_name")
        .eq("id", claims.id)
        .single();
      fideFields = buildFideProfileUpdate(
        player,
        nameRow?.first_name ?? "",
        nameRow?.last_name ?? "",
        new Date().toISOString(),
      );
    }
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabaseAdmin
      .from("player_profiles")
      .upsert(
        { user_id: claims.id, ...update, ...fideFields },
        { onConflict: "user_id" },
      );

    if (error) {
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: error.message } },
        { status: 500 },
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
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: error.message } },
        { status: 500 },
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
