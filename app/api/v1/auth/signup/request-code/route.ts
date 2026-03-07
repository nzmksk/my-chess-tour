import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { storeVerificationCode } from "@/lib/redis";
import { sendVerificationEmail } from "@/lib/email";

function generateCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { email } = body as { email?: string };

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  // Check if email already exists in public.users
  const { data: existing, error: dbError } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("email", email.toLowerCase().trim())
    .maybeSingle();

  if (dbError) {
    return NextResponse.json(
      { error: "Failed to validate email" },
      { status: 500 }
    );
  }

  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists", code: "EMAIL_EXISTS" },
      { status: 409 }
    );
  }

  const code = generateCode();

  try {
    await storeVerificationCode(email, code);
  } catch {
    return NextResponse.json(
      { error: "Failed to store verification code" },
      { status: 500 }
    );
  }

  try {
    await sendVerificationEmail(email, code);
  } catch {
    return NextResponse.json(
      { error: "Failed to send verification email" },
      { status: 500 }
    );
  }

  return NextResponse.json({ message: "Verification code sent" }, { status: 200 });
}
