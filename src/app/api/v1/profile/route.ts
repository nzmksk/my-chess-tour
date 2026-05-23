import { createClient } from "@/services/supabase/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import type {
  ChessTitle,
  Gender,
  UpdateProfilePayload,
} from "@/app/profile/types";

const VALID_GENDERS = new Set<string>(["male", "female"]);
const VALID_TITLES = new Set<string>([
  "GM",
  "WGM",
  "IM",
  "WIM",
  "FM",
  "WFM",
  "CM",
  "WCM",
]);

export async function GET(): Promise<NextResponse> {
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

  const [{ data: userData, error: userError }, { data: profileData }] =
    await Promise.all([
      supabaseAdmin
        .from("users")
        .select("id, first_name, last_name, email, avatar_url")
        .eq("id", user.id)
        .single(),
      supabaseAdmin
        .from("player_profiles")
        .select(
          "date_of_birth, gender, nationality, is_oku, fide_id, fide_rating, title, mcf_id, national_rating",
        )
        .eq("user_id", user.id)
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
      is_oku: profileData?.is_oku ?? false,
      fide_id: profileData?.fide_id ?? null,
      fide_rating: profileData?.fide_rating ?? null,
      title: profileData?.title ?? null,
      mcf_id: profileData?.mcf_id ?? null,
      national_rating: profileData?.national_rating ?? null,
    },
  });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const errors: string[] = [];
  const update: UpdateProfilePayload = {};

  if ("gender" in body) {
    if (body.gender === null) {
      update.gender = null;
    } else if (typeof body.gender === "string" && VALID_GENDERS.has(body.gender)) {
      update.gender = body.gender as Gender;
    } else {
      errors.push("gender must be 'male', 'female', or null");
    }
  }

  if ("title" in body) {
    if (body.title === null) {
      update.title = null;
    } else if (typeof body.title === "string" && VALID_TITLES.has(body.title)) {
      update.title = body.title as ChessTitle;
    } else {
      errors.push(
        `title must be one of: ${[...VALID_TITLES].join(", ")}, or null`,
      );
    }
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
      errors.push("fide_id must be a positive integer no greater than 2147483647 or null");
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
      errors.push("mcf_id must be a positive integer no greater than 2147483647 or null");
    }
  }

  if ("national_rating" in body) {
    if (body.national_rating === null) {
      update.national_rating = null;
    } else if (
      typeof body.national_rating === "number" &&
      Number.isInteger(body.national_rating) &&
      body.national_rating >= 0 &&
      body.national_rating <= 3000
    ) {
      update.national_rating = body.national_rating;
    } else {
      errors.push("national_rating must be a non-negative integer no greater than 3000 or null");
    }
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
        errors.push("date_of_birth must be a valid calendar date (YYYY-MM-DD) or null");
      }
    } else {
      errors.push("date_of_birth must be a valid calendar date (YYYY-MM-DD) or null");
    }
  }

  if ("nationality" in body) {
    if (body.nationality === null) {
      update.nationality = null;
    } else if (typeof body.nationality === "string" && body.nationality.trim()) {
      update.nationality = body.nationality.trim();
    } else {
      errors.push("nationality must be a non-empty string or null");
    }
  }

  if ("is_oku" in body) {
    if (typeof body.is_oku === "boolean") {
      update.is_oku = body.is_oku;
    } else {
      errors.push("is_oku must be a boolean");
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

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "No valid fields provided" } },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin
    .from("player_profiles")
    .upsert(
      { user_id: user.id, ...update },
      { onConflict: "user_id" },
    );

  if (error) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
