import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { createClient } from "@/services/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      { status: 401 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch (err) {
    console.error(
      "Failed to parse JSON body in complete-profile endpoint",
      err,
    );
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const { gender, nationality, dateOfBirth, fideId, mcfId, isOku, avatarUrl } =
    body as {
      gender?: string;
      nationality?: string;
      dateOfBirth?: string;
      fideId?: string;
      mcfId?: string;
      isOku?: boolean;
      avatarUrl?: string;
    };

  if (gender && !["male", "female"].includes(gender.toLowerCase())) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Gender must be Male or Female",
        },
      },
      { status: 400 },
    );
  }

  if (fideId && !/^\d+$/.test(fideId)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "FIDE ID must contain digits only",
        },
      },
      { status: 400 },
    );
  }

  if (mcfId && !/^\d+$/.test(mcfId)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "MCF ID must contain digits only",
        },
      },
      { status: 400 },
    );
  }

  // Upsert (not update) keyed on the user_id PK: the signup trigger normally
  // pre-creates this row, but if it's ever missing a plain update would affect
  // 0 rows and silently drop the profile data.
  const { error: profileError } = await supabaseAdmin
    .from("player_profiles")
    .upsert(
      {
        user_id: user.id,
        gender: gender ? (gender.toLowerCase() as "male" | "female") : null,
        nationality: nationality || null,
        date_of_birth: dateOfBirth || null,
        fide_id: fideId || null,
        mcf_id: mcfId || null,
        is_oku: isOku ?? false,
      },
      { onConflict: "user_id" },
    );

  if (profileError) {
    console.error(
      "Failed to update player profile for user ID:",
      user.id,
      profileError,
    );
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to save profile",
        },
      },
      { status: 500 },
    );
  }

  if (avatarUrl !== undefined) {
    const { error: avatarError } = await supabaseAdmin
      .from("users")
      .update({ avatar_url: avatarUrl || null })
      .eq("id", user.id);

    if (avatarError) {
      console.error(
        "Failed to update avatar URL for user ID:",
        user.id,
        avatarError,
      );
      return NextResponse.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Failed to save avatar",
          },
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ message: "Profile updated" }, { status: 200 });
}
