import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { createClient } from "@/services/supabase/server";
import {
  getVerificationCode,
  deleteVerificationCode,
  getVerifyAttempts,
  recordVerifyAttempt,
  resetVerifyAttempts,
  MAX_VERIFY_ATTEMPTS,
} from "@/services/redis/redis";
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

  const { email, code } = body as {
    email?: string;
    code?: string;
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

  const normalized = email.toLowerCase().trim();

  // Brute-force guard: once too many wrong codes have been tried, stop checking
  // until the code window expires (the user must request a fresh code).
  const attempts = await getVerifyAttempts(normalized);
  if (attempts >= MAX_VERIFY_ATTEMPTS) {
    return NextResponse.json(
      {
        error: {
          code: "TOO_MANY_ATTEMPTS",
          message: "Too many incorrect attempts. Please request a new code.",
        },
      },
      { status: 429 },
    );
  }

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
    const count = await recordVerifyAttempt(normalized);
    if (count >= MAX_VERIFY_ATTEMPTS) {
      return NextResponse.json(
        {
          error: {
            code: "TOO_MANY_ATTEMPTS",
            message: "Too many incorrect attempts. Please request a new code.",
          },
        },
        { status: 429 },
      );
    }
    const remaining = MAX_VERIFY_ATTEMPTS - count;
    return NextResponse.json(
      {
        error: {
          code: "CODE_INVALID",
          message: `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
        },
      },
      { status: 422 },
    );
  }

  // Code is correct — clear the failed-attempt counter.
  await resetVerifyAttempts(normalized);

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

  // Mint a session for the already-existing, now-verified user without the
  // password ever leaving the server. admin.generateLink only generates the
  // token (it does not send an email), and verifyOtp on the SSR client writes
  // the session cookies onto the response.
  const { data: link, error: linkError } =
    await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: normalized,
    });

  if (linkError || !link.properties?.hashed_token) {
    console.error(
      "Failed to generate session link for:",
      normalized,
      linkError,
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

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
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

  // Consume the code so it can't be replayed now that verification succeeded.
  // Best-effort: the user is already verified and signed in, so a Redis hiccup
  // here shouldn't fail the request (the code expires on its own TTL anyway).
  try {
    await deleteVerificationCode(normalized);
  } catch (err) {
    console.error(
      "Failed to delete verification code after success for:",
      normalized,
      err,
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
