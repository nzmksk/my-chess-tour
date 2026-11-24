import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { SUPPORT_EMAIL } from "@/lib/reference/contact";
import {
  INVITATION_TOKEN_RE,
  hashInvitationToken,
} from "@/services/organizations/invitations";

export function accountClaimUrl(token: string): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return `${siteUrl}/claim/${token}`;
}

export const EMAIL_TAKEN_MESSAGE = `This email address already has a MY Chess Tour account. We don't merge accounts automatically, so ask the player to contact ${SUPPORT_EMAIL} and we'll help.`;

export type AccountClaimState = "pending" | "expired" | "accepted" | "closed";

export interface AccountClaimView {
  tokenHash: string;
  state: AccountClaimState;
  email: string;
  expiresAt: string;
  playerFirstName: string;
  playerLastName: string;
  guardianName: string;
}

type Person = { first_name: string | null; last_name: string | null } | null;

interface ClaimRow {
  status: "pending" | "accepted" | "cancelled";
  email: string;
  expires_at: string;
  guardian_user_id: string;
  dependent_user_id: string;
  dependent: Person & { account_type?: string };
  guardian: Person;
}

function nameOf(person: Person): string {
  return (
    [person?.first_name, person?.last_name].filter(Boolean).join(" ") ||
    "Your guardian"
  );
}

export async function getAccountClaimByToken(
  token: string,
  now: Date = new Date(),
): Promise<AccountClaimView | null> {
  if (!INVITATION_TOKEN_RE.test(token)) return null;
  const tokenHash = hashInvitationToken(token);

  const { data, error } = await supabaseAdmin
    .from("account_claims")
    .select(
      `status, email, expires_at, guardian_user_id, dependent_user_id,
       dependent:users!dependent_user_id(first_name, last_name, account_type),
       guardian:users!guardian_user_id(first_name, last_name)`,
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) throw new Error(`account claim lookup failed: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as ClaimRow;

  let state: AccountClaimState =
    row.status === "accepted"
      ? "accepted"
      : row.status === "cancelled"
        ? "closed"
        : new Date(row.expires_at) <= now
          ? "expired"
          : "pending";

  if (state === "pending") {
    const { data: guardianship, error: gError } = await supabaseAdmin
      .from("guardianships")
      .select("id")
      .eq("guardian_user_id", row.guardian_user_id)
      .eq("dependent_user_id", row.dependent_user_id)
      .eq("status", "active")
      .maybeSingle();
    if (gError) {
      throw new Error(
        `account claim guardianship lookup failed: ${gError.message}`,
      );
    }
    if (!guardianship || row.dependent?.account_type !== "managed") {
      state = "closed";
    }
  }

  return {
    tokenHash,
    state,
    email: row.email,
    expiresAt: row.expires_at,
    playerFirstName: row.dependent?.first_name ?? "",
    playerLastName: row.dependent?.last_name ?? "",
    guardianName: nameOf(row.guardian),
  };
}

export function accountClaimErrorResponse(
  error: { message?: string },
  action: string,
): NextResponse {
  const message = error.message ?? "";
  const respond = (code: string, text: string, status: number) =>
    NextResponse.json({ error: { code, message: text } }, { status });

  if (message.includes("DEPENDENT_NOT_FOUND")) {
    return respond("NOT_FOUND", "Dependent not found", 404);
  }
  if (message.includes("EMAIL_TAKEN")) {
    return respond("EMAIL_TAKEN", EMAIL_TAKEN_MESSAGE, 409);
  }
  if (message.includes("UNDER_18")) {
    return respond(
      "UNDER_18",
      "A player must be 18 or over to hold their own account.",
      422,
    );
  }
  if (message.includes("CLAIM_NOT_ALLOWED")) {
    return respond(
      "CLAIM_NOT_ALLOWED",
      "This player already signs in to their own account.",
      422,
    );
  }
  if (message.includes("INVALID_EMAIL")) {
    return respond("VALIDATION_ERROR", "Enter a valid email address.", 400);
  }
  if (
    message.includes("CLAIM_INVALID") ||
    message.includes("CLAIM_EMAIL_MISMATCH") ||
    message.includes("CLAIM_EMAIL_UNVERIFIED")
  ) {
    return respond(
      "CLAIM_CLOSED",
      "This link can't be used any more. Ask whoever sent it for a new one.",
      410,
    );
  }
  return internalErrorResponse(
    `Account claims: unexpected error ${action}`,
    error,
  );
}
