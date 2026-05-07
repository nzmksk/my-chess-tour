import { NextRequest, NextResponse } from "next/server";
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
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  const { email } = body as { email?: string };

  if (!email || typeof email !== "string") {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Email is required" } },
      { status: 400 }
    );
  }

  const normalized = email.toLowerCase().trim();

  if (!validateEmail(normalized)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid email format" } },
      { status: 400 }
    );
  }

  // Check if email already exists in public.users
  const { data: existing, error: dbError } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("email", normalized)
    .maybeSingle();

  if (dbError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to validate email" } },
      { status: 500 }
    );
  }

  if (existing) {
    return NextResponse.json(
      { error: { code: "EMAIL_EXISTS", message: "An account with this email already exists" } },
      { status: 409 }
    );
  }

  const code = generateCode();

  try {
    await storeVerificationCode(email, code);
  } catch {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to store verification code" } },
      { status: 500 }
    );
  }

  try {
    await sendVerificationEmail(email, code);
  } catch {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to send verification email" } },
      { status: 500 }
    );
  }

  return NextResponse.json({ message: "Verification code sent" }, { status: 200 });
}
