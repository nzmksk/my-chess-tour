import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/services/supabase/admin";
import { createClient } from "@/services/supabase/server";
import { getVerificationCode } from "@/services/redis/redis";

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  const {
    email,
    code,
    password,
    firstName,
    lastName,
    gender,
    nationality,
    dateOfBirth,
    state,
    fideId,
    mcfId,
    isOku,
  } = body as {
    email?: string;
    code?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    gender?: string;
    nationality?: string;
    dateOfBirth?: string;
    state?: string;
    fideId?: string;
    mcfId?: string;
    isOku?: boolean;
  };

  if (!email || typeof email !== "string") {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Email is required" } },
      { status: 400 }
    );
  }
  if (!code || typeof code !== "string") {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Code is required" } },
      { status: 400 }
    );
  }
  if (!password || !firstName || !lastName) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Missing required registration fields" } },
      { status: 400 }
    );
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Password must be at least 8 characters" } },
      { status: 400 }
    );
  }

  const stored = await getVerificationCode(email);

  if (!stored) {
    return NextResponse.json(
      { error: { code: "CODE_EXPIRED", message: "Code has expired. Please request a new one." } },
      { status: 410 }
    );
  }

  if (stored.toUpperCase() !== code.toUpperCase()) {
    return NextResponse.json(
      { error: { code: "CODE_INVALID", message: "Incorrect code. Please try again." } },
      { status: 422 }
    );
  }

  // Hash password for public.users — the trigger reads this from user metadata
  const passwordHash = await bcrypt.hash(password, 12);

  // Create auth user (email already verified by our code)
  const { data: authData, error: authError } =
    await supabaseAdmin.auth.admin.createUser({
      email: email.toLowerCase().trim(),
      password,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        password_hash: passwordHash,
      },
    });

  if (authError) {
    if (
      authError.code === "email_exists" ||
      authError.message?.toLowerCase().includes("already registered")
    ) {
      return NextResponse.json(
        { error: { code: "EMAIL_EXISTS", message: "An account with this email already exists" } },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: authError.message } },
      { status: 400 }
    );
  }

  const userId = authData.user.id;

  // Update the player_profile row created by the handle_new_user trigger
  const { error: profileError } = await supabaseAdmin
    .from("player_profiles")
    .update({
      gender: gender || null,
      nationality: nationality || null,
      date_of_birth: dateOfBirth || null,
      state: state || null,
      fide_id: fideId || null,
      mcf_id: mcfId || null,
      is_oku: isOku ?? false,
    })
    .eq("user_id", userId);

  if (profileError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Account created but failed to save profile" } },
      { status: 500 }
    );
  }

  // Sign the user in so the SSR client writes session cookies to the response
  const supabase = await createClient();
  await supabase.auth.signInWithPassword({
    email: email.toLowerCase().trim(),
    password,
  });

  return NextResponse.json({ message: "Account created successfully" }, { status: 201 });
}
