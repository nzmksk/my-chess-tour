import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import {
  storeVerificationCode,
  startResendCooldown,
  clearResendCooldown,
} from "@/services/redis/redis";
import { sendVerificationEmail } from "@/services/email/email";
import { validateEmail } from "@/services/auth/auth-validation";

function generateCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export async function POST(request: NextRequest) {
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

  if (!user) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Account not found" } },
      { status: 404 },
    );
  }

  if (user.is_verified) {
    return NextResponse.json(
      {
        error: {
          code: "ALREADY_VERIFIED",
          message: "This account is already verified",
        },
      },
      { status: 409 },
    );
  }

  // Server-side throttle: prevent email bombing of a valid unverified address
  // by anyone calling this endpoint directly (the client cooldown isn't enough).
  const cooldown = await startResendCooldown(normalized);
  if (cooldown > 0) {
    const minutes = Math.ceil(cooldown / 60);
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: `Please wait ${minutes} minute${minutes === 1 ? "" : "s"} before requesting another code.`,
        },
      },
      { status: 429, headers: { "Retry-After": String(cooldown) } },
    );
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

  return NextResponse.json(
    { message: "Verification code resent" },
    { status: 200 },
  );
}
