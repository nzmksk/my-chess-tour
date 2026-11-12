import { NextResponse } from "next/server";
import { UUID_RE } from "@/app/api/v1/organizations/_lib/authorize-org";

export interface EarlyPayoutRequest {
  tournament_id: string;
  amount_cents: number;
  /** Trimmed. Shown to the reviewing admin, so it has to say something. */
  reason: string;
}

export const MAX_REASON_LENGTH = 1000;

// Shape only. Whether the amount fits the cap, and everything else about the
// tournament, is request_early_payout's to decide under its lock.
export function validateEarlyPayoutRequest(
  body: unknown,
): { data: EarlyPayoutRequest } | { error: NextResponse } {
  const fail = (message: string) => ({
    error: NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message } },
      { status: 400 },
    ),
  });

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail("Invalid request body");
  }

  const b = body as Record<string, unknown>;

  if (typeof b.tournament_id !== "string" || !UUID_RE.test(b.tournament_id)) {
    return fail("tournament_id must be a valid ID");
  }

  if (
    typeof b.amount_cents !== "number" ||
    !Number.isSafeInteger(b.amount_cents) ||
    b.amount_cents <= 0
  ) {
    return fail("amount_cents must be a positive whole number of cents");
  }

  if (typeof b.reason !== "string" || b.reason.trim() === "") {
    return fail("Please say what the early payout is for");
  }
  if (b.reason.trim().length > MAX_REASON_LENGTH) {
    return fail(`The reason must be ${MAX_REASON_LENGTH} characters or fewer`);
  }

  return {
    data: {
      tournament_id: b.tournament_id,
      amount_cents: b.amount_cents,
      reason: b.reason.trim(),
    },
  };
}
