import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/services/supabase/admin";
import { storeVerificationCode } from "@/services/redis/redis";
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

  if (password.length < 8) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Password must be at least 8 characters",
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

  const passwordHash = await bcrypt.hash(password, 12);

  const { error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: normalized,
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

  const code = generateCode();

  try {
    await storeVerificationCode(normalized, code);
  } catch (err) {
    console.error(
      `Failed to store verification code for: ${normalized} with error: ${err}`,
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
    await sendVerificationEmail(normalized, code);
  } catch (err) {
    console.error(
      `Failed to send verification email for: ${normalized} with error: ${err}`,
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
    { message: "Account created. Verification code sent." },
    { status: 201 },
  );
}
