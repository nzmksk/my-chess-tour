import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { createClient } from "@/services/supabase/server";
import { getVerificationCode } from "@/services/redis/redis";
import { SIGNUP_STEP_COOKIE, SIGNUP_STEP_MAX_AGE } from "@/lib/signup-cookie";

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch (err) {
    console.error("Failed to parse JSON body in verify-code endpoint", err);
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const { email, code, password } = body as {
    email?: string;
    code?: string;
    password?: string;
  };

  if (!email || typeof email !== "string") {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Email is required" } },
      { status: 400 },
    );
  }

  if (!code || typeof code !== "string") {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Code is required" } },
      { status: 400 },
    );
  }

  if (!password || typeof password !== "string") {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Password is required" } },
      { status: 400 },
    );
  }

  const normalized = email.toLowerCase().trim();

  const stored = await getVerificationCode(normalized);
  if (!stored) {
    return NextResponse.json(
      {
        error: {
          code: "CODE_EXPIRED",
          message: "Code has expired. Please request a new one.",
        },
      },
      { status: 410 },
    );
  }

  if (stored.toUpperCase() !== code.toUpperCase()) {
    return NextResponse.json(
      {
        error: {
          code: "CODE_INVALID",
          message: "Incorrect code. Please try again.",
        },
      },
      { status: 422 },
    );
  }

  // Mark the user as verified in public.users
  const { error: updateError } = await supabaseAdmin
    .from("users")
    .update({ is_verified: true, verified_at: new Date().toISOString() })
    .eq("email", normalized);

  if (updateError) {
    console.error(
      "Failed to update verification status for:",
      normalized,
      updateError,
    );
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to verify account",
        },
      },
      { status: 500 },
    );
  }

  // Sign the user in so the SSR client writes session cookies to the response
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: normalized,
    password,
  });

  if (signInError) {
    console.error(
      "Failed to sign in after verification:",
      normalized,
      signInError,
    );
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Account verified but failed to sign in",
        },
      },
      { status: 500 },
    );
  }

  // Advance the signup step so the route guard lets the user into the profile
  // step — and only now, after the email is actually verified.
  const response = NextResponse.json(
    { message: "Email verified successfully" },
    { status: 200 },
  );
  response.cookies.set(SIGNUP_STEP_COOKIE, "profile", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SIGNUP_STEP_MAX_AGE,
  });
  return response;
}
