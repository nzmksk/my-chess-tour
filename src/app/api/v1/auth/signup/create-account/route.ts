import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import {
  storeVerificationCode,
  recordSignupAttempt,
  MAX_SIGNUP_ATTEMPTS_PER_IP,
} from "@/services/redis/redis";
import { sendVerificationEmail } from "@/services/email/email";
import {
  validateEmail,
  checkPasswordRequirements,
} from "@/services/auth/auth-validation";
import { SIGNUP_STEP_COOKIE, SIGNUP_STEP_MAX_AGE } from "@/lib/signup-cookie";
import { getClientIp } from "@/lib/request-ip";
import { generateCode } from "@/services/auth/verification-code";

// Undo a freshly-created account when a post-creation step (storing/sending the
// verification code) fails — otherwise the half-provisioned account would block
// the user from ever retrying signup (the email already exists).
// public.users has no FK to auth.users, so both must be removed explicitly; the
// player_profiles row cascades from public.users via ON DELETE CASCADE.
async function rollbackAccount(userId: string): Promise<void> {
  const { error: dbDeleteError } = await supabaseAdmin
    .from("users")
    .delete()
    .eq("id", userId);
  if (dbDeleteError) {
    console.error(
      "Failed to roll back users row for ID:",
      userId,
      dbDeleteError,
    );
  }

  const { error: authDeleteError } =
    await supabaseAdmin.auth.admin.deleteUser(userId);
  if (authDeleteError) {
    console.error(
      "Failed to roll back auth user for ID:",
      userId,
      authDeleteError,
    );
  }
}

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
    console.error("Failed to parse JSON body in create-account endpoint", err);
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const { email, password, firstName, lastName } = body as {
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
  };

  if (!email || typeof email !== "string") {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Email is required" } },
      { status: 400 },
    );
  }

  if (!password || typeof password !== "string") {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Password is required" } },
      { status: 400 },
    );
  }

  if (!firstName || typeof firstName !== "string") {
    return NextResponse.json(
      {
        error: { code: "VALIDATION_ERROR", message: "First name is required" },
      },
      { status: 400 },
    );
  }

  if (!lastName || typeof lastName !== "string") {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Last name is required" } },
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

  const NAME_PATTERN = /^[a-zA-ZÀ-ɏ\s'.\-]+$/;
  if (!NAME_PATTERN.test(firstName.trim())) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message:
            "First name can only contain letters, spaces, hyphens, and apostrophes",
        },
      },
      { status: 400 },
    );
  }
  if (!NAME_PATTERN.test(lastName.trim())) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message:
            "Last name can only contain letters, spaces, hyphens, and apostrophes",
        },
      },
      { status: 400 },
    );
  }

  // Enforce the same complexity rules the client applies, so a direct API call
  // can't create an account with a weak password.
  const passwordReqs = checkPasswordRequirements(password);
  if (!Object.values(passwordReqs).every(Boolean)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message:
            "Password must be at least 8 characters and include uppercase, lowercase, a number, and a symbol",
        },
      },
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

  // Supabase Auth securely stores the password itself (auth.users.encrypted_password)
  // and login uses signInWithPassword — so we don't store our own hash anywhere.
  const { data: created, error: authError } =
    await supabaseAdmin.auth.admin.createUser({
      email: normalized,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
      },
    });

  if (authError) {
    if (
      authError.code === "email_exists" ||
      authError.message?.toLowerCase().includes("already registered")
    ) {
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
    console.error("Failed to create auth user", authError);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: authError.message } },
      { status: 500 },
    );
  }

  const userId = created.user?.id;
  const code = generateCode();

  try {
    await storeVerificationCode(normalized, code);
  } catch (err) {
    console.error(
      `Failed to store verification code for: ${normalized} with error: ${err}`,
    );
    if (userId) await rollbackAccount(userId);
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
    if (userId) await rollbackAccount(userId);
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

  const response = NextResponse.json(
    { message: "Account created. Verification code sent." },
    { status: 201 },
  );
  response.cookies.set(SIGNUP_STEP_COOKIE, "verify", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SIGNUP_STEP_MAX_AGE,
  });
  return response;
}
