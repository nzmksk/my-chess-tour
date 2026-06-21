import { NextResponse } from "next/server";
import { validateEmail } from "@/services/auth/auth-validation";

const VALID_ROLES = ["admin", "member"] as const;
type InviteRole = (typeof VALID_ROLES)[number];

export interface InviteRequest {
  email: string;
  role: InviteRole;
}

export function validateInviteRequest(
  body: unknown,
): { data: InviteRequest } | { error: NextResponse } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      error: NextResponse.json(
        {
          error: { code: "VALIDATION_ERROR", message: "Invalid request body" },
        },
        { status: 400 },
      ),
    };
  }

  const b = body as Record<string, unknown>;

  if (!b.email || typeof b.email !== "string" || b.email.trim() === "") {
    return {
      error: NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Email is required" } },
        { status: 400 },
      ),
    };
  }

  if (!validateEmail(b.email)) {
    return {
      error: NextResponse.json(
        {
          error: { code: "VALIDATION_ERROR", message: "Invalid email address" },
        },
        { status: 400 },
      ),
    };
  }

  if (!b.role || !VALID_ROLES.includes(b.role as InviteRole)) {
    return {
      error: NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Role must be 'admin' or 'member'",
          },
        },
        { status: 400 },
      ),
    };
  }

  return {
    data: {
      email: (b.email as string).trim().toLowerCase(),
      role: b.role as InviteRole,
    },
  };
}
