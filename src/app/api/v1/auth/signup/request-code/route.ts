import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import {
  storeVerificationCode,
  recordSignupAttempt,
  MAX_SIGNUP_ATTEMPTS_PER_IP,
} from "@/services/redis/redis";
import { sendVerificationEmail } from "@/services/email/email";
import { validateEmail } from "@/services/auth/auth-validation";
import { getClientIp } from "@/lib/request-ip";
import { generateCode } from "@/services/auth/verification-code";

export async function POST(request: NextRequest) {
  // Per-IP rate limit so the email-existence response can't be used to probe
  // which addresses are registered at scale.
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
    console.error("Failed to parse JSON body in request-code endpoint", err);
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

  // Check if email already exists in public.users
  const { data: existing, error: dbError } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("email", normalized)
    .maybeSingle();

  if (dbError) {
    console.error(
      "Database error while checking existing email: %s",
      normalized,
      dbError,
    );
    return NextResponse.json(
      {
        error: { code: "INTERNAL_ERROR", message: "Failed to validate email" },
      },
      { status: 500 },
    );
  }

  if (existing) {
    console.error(
      `Attempt to request verification code for already existing email: ${normalized}`,
    );
    return NextResponse.json(
      {
        error: {
          code: "EMAIL_EXISTS",
          message: "An account with this email already exists",
        },
      },
      { status: 409 },
    );
  }

  const code = generateCode();

  try {
    await storeVerificationCode(email, code);
  } catch (err) {
    console.error(
      `Failed to store verification code for: ${email} with error:, ${err}`,
    );
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
    await sendVerificationEmail(email, code);
  } catch (err) {
    console.error(
      `Failed to send verification email for: ${email} with error: ${err}`,
    );
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

  return NextResponse.json(
    { message: "Verification code sent" },
    { status: 200 },
  );
}
