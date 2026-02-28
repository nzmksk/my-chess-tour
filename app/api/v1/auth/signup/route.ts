import { createClient } from "@/lib/supabase/server";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";

interface SignupRequest {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
}

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { email, password, first_name, last_name } =
    body as SignupRequest;

  // Validate required fields
  const missing: string[] = [];
  if (!email) missing.push("email");
  if (!password) missing.push("password");
  if (!first_name) missing.push("first_name");
  if (!last_name) missing.push("last_name");

  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required fields: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return NextResponse.json(
      { error: "Invalid email format" },
      { status: 400 }
    );
  }

  // Password length validation
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }

  // Hash the password before passing it to the auth layer.
  // The handle_new_user trigger reads password_hash from auth metadata and
  // stores it in public.users.password (never the plaintext value).
  const passwordHash = await bcrypt.hash(password, 12);

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name,
        last_name,
        password_hash: passwordHash,
      },
    },
  });

  if (error) {
    // Supabase returns 400 for existing email with email confirmation disabled,
    // or a fake success with identities:[] when confirmation is enabled.
    if (
      error.code === "user_already_exists" ||
      error.message?.toLowerCase().includes("already registered")
    ) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }

    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // When email confirmation is enabled, identities is an empty array for
  // duplicate emails (Supabase returns a fake success to prevent enumeration).
  // We surface a generic "check your email" message in both cases.
  return NextResponse.json(
    {
      message:
        "Signup successful. Please check your email to confirm your account.",
      user_id: data.user?.id ?? null,
    },
    { status: 201 }
  );
}
