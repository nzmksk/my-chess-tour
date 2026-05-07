import { createClient } from "@/services/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { validateEmail } from "@/services/auth/auth-validation";

interface LoginRequest {
  email: string;
  password: string;
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

  const { email, password } = body as LoginRequest;

  // Validate required fields
  const missing: string[] = [];
  if (!email) missing.push("email");
  if (!password) missing.push("password");

  if (missing.length > 0) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: `Missing required fields: ${missing.join(", ")}` } },
      { status: 400 }
    );
  }

  // Basic email format validation
  if (!validateEmail(email)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid email format" } },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    if (error.message?.toLowerCase().includes("invalid login credentials")) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid email or password" } },
        { status: 401 }
      );
    }

    if (error.message?.toLowerCase().includes("email not confirmed")) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Email not confirmed. Please check your inbox." } },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 400 }
    );
  }

  return NextResponse.json(
    {
      message: "Login successful",
      user_id: data.user?.id ?? null,
    },
    { status: 200 }
  );
}
