import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { reviewBankAccountName } from "@/services/payouts/bank-account";
import { onPlayerBankVerdict } from "@/services/prizes/execute";
import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { afterResponse } from "@/lib/http/after-response";
import { withAuditContext } from "@/services/supabase/audit-context";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_NOTE_LENGTH = 1000;

function fail(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function handlePatch(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return fail(400, "VALIDATION_ERROR", "Invalid bank account ID");
  }

  const claims = await getAuthClaims();
  if (!claims) return fail(401, "UNAUTHORIZED", "Authentication required");

  const supabase = await createClient();
  const { data: isAdmin, error: permissionError } = await supabase.rpc(
    "has_global_permission",
    { p_user_id: claims.id, p_permission: "platform.manage" },
  );
  if (permissionError) {
    return internalErrorResponse(
      "PATCH /api/v1/admin/bank-accounts/[id]: permissionError",
      permissionError,
    );
  }
  if (!isAdmin) return fail(403, "FORBIDDEN", "Admin access required");

  let body: { action?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, "VALIDATION_ERROR", "Invalid request body");
  }

  const { action, note } = body ?? {};
  if (action !== "confirm" && action !== "reject") {
    return fail(
      400,
      "VALIDATION_ERROR",
      "action must be 'confirm' or 'reject'",
    );
  }
  if (typeof note !== "string" || !note.trim()) {
    return fail(
      400,
      "VALIDATION_ERROR",
      action === "confirm"
        ? "Say why this account can be paid despite the name"
        : "Give the owner a reason for the rejection",
    );
  }
  if (note.trim().length > MAX_NOTE_LENGTH) {
    return fail(
      400,
      "VALIDATION_ERROR",
      `The note must be ${MAX_NOTE_LENGTH} characters or fewer`,
    );
  }

  const result = await reviewBankAccountName({
    bankAccountId: id,
    reviewerId: claims.id,
    action,
    note: note.trim(),
  });

  if (result.error) {
    if (result.error.code === "P0002") {
      return fail(404, "NOT_FOUND", "Bank account not found");
    }
    if (result.error.message.startsWith("NOT_UNDER_REVIEW")) {
      return fail(
        409,
        "NOT_UNDER_REVIEW",
        "This account isn't waiting for a name review. It may already have been decided.",
      );
    }
    if (result.error.message.startsWith("SUPERSEDED")) {
      return fail(
        409,
        "SUPERSEDED",
        "The owner has replaced this account since. Refresh to see the one waiting now.",
      );
    }
    return internalErrorResponse(
      "PATCH /api/v1/admin/bank-accounts/[id]: review_bank_account_name failed",
      result.error,
    );
  }

  const verdict = result.playerVerdict;
  if (verdict) {
    afterResponse(() => onPlayerBankVerdict(verdict.userId, verdict.verified));
  }

  return NextResponse.json(
    { data: { id, status: result.status ?? null } },
    { status: 200 },
  );
}

export const PATCH = withAuditContext(
  "admin.bank-account.name-review",
  handlePatch,
);
