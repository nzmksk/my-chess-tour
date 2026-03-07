import { NextRequest, NextResponse } from "next/server";
import { getVerificationCode, deleteVerificationCode } from "@/lib/redis";

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { email, code } = body as { email?: string; code?: string };

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "Code is required" }, { status: 400 });
  }

  const stored = await getVerificationCode(email);

  if (!stored) {
    return NextResponse.json(
      { error: "Code has expired. Please request a new one.", code: "CODE_EXPIRED" },
      { status: 410 }
    );
  }

  if (stored.toUpperCase() !== code.toUpperCase()) {
    return NextResponse.json(
      { error: "Incorrect code. Please try again.", code: "CODE_INVALID" },
      { status: 422 }
    );
  }

  await deleteVerificationCode(email);

  return NextResponse.json({ message: "Email verified successfully" }, { status: 200 });
}
