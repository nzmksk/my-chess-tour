import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import {
  storeVerificationCode,
  startResendCooldown,
  clearResendCooldown,
  recordSignupAttempt,
  MAX_SIGNUP_ATTEMPTS_PER_IP,
} from "@/services/redis/redis";
import { sendVerificationEmail } from "@/services/email/email";
import { validateEmail } from "@/services/auth/auth-validation";
import { getClientIp } from "@/lib/request-ip";
import { generateCode } from "@/services/auth/verification-code";

// A single response shared by every account-state outcome (missing account,
// already verified, code sent, or silently throttled) so this endpoint can't
// be used to discover whether an email is registered or its verification state.
function genericOk() {
  return NextResponse.json(
    {
      message: "If your account needs verification, a new code has been sent.",
    },
    { status: 200 },
  );
}

export async function POST(request: NextRequest) {
  // Per-IP rate limit (consistent with the other signup endpoints) to cap
  // cross-email probing.
  const ip = getClientIp(request);
  if ((await recordSignupAttempt(ip)) > MAX_SIGNUP_ATTEMPTS_PER_IP) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "Too many attempts. Please try again later.",
        },
      },
      { status: 429 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch (err) {
    console.error("Failed to parse JSON body in resend-code endpoint", err);
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const { email } = body as { email?: string };

  if (!email || typeof email !== "string") {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Email is required" } },
      { status: 400 },
    );
  }

  const normalized = email.toLowerCase().trim();

  if (!validateEmail(normalized)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid email format" } },
      { status: 400 },
    );
  }

  const { data: user, error: dbError } = await supabaseAdmin
    .from("users")
    .select("id, is_verified")
    .eq("email", normalized)
    .maybeSingle();

  if (dbError) {
    console.error(
      "Database error while looking up user for resend: %s",
      normalized,
      dbError,
    );
    return NextResponse.json(
      {
        error: { code: "INTERNAL_ERROR", message: "Failed to look up account" },
      },
      { status: 500 },
    );
  }

  // Only actually send for an existing, unverified account. Missing and
  // already-verified accounts fall through to the same generic response so
  // neither case is distinguishable from a successful resend.
  if (!user || user.is_verified) {
    return genericOk();
  }

  // Throttle real sends (anti email-bombing), but never surface the cooldown —
  // a 429 here would reveal the address is registered and unverified.
  const cooldown = await startResendCooldown(normalized);
  if (cooldown > 0) {
    return genericOk();
  }

  const code = generateCode();

  try {
    await storeVerificationCode(normalized, code);
  } catch (err) {
    console.error(
      `Failed to store verification code for: ${normalized} with error: ${err}`,
    );
    // Release the cooldown so the user isn't locked out over a failed send.
    await clearResendCooldown(normalized);
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to store verification code",
        },
      },
      { status: 500 },
    );
  }

  try {
    await sendVerificationEmail(normalized, code);
  } catch (err) {
    console.error(
      `Failed to send verification email for: ${normalized} with error: ${err}`,
    );
    await clearResendCooldown(normalized);
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to send verification email",
        },
      },
      { status: 500 },
    );
  }

  return genericOk();
}
