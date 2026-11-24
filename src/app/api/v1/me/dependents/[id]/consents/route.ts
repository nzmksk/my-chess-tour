import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { isSensitiveDataCategory } from "@/lib/reference/legal";
import {
  consentWording,
  grantSensitiveDataConsent,
} from "@/services/consent/sensitive-data";
import { dependentNotFoundResponse } from "@/services/guardianship/dependents";
import { resolveDependentForCaller } from "@/services/guardianship/resolve-dependent";
import { withAuditContext } from "@/services/supabase/audit-context";

type RouteContext = { params: Promise<{ id: string }> };

const ROUTE = "POST /api/v1/me/dependents/[id]/consents";

async function handlePost(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  const resolved = await resolveDependentForCaller(id, ROUTE);
  if (!resolved.ok) return resolved.response;
  const { guardianId, dependent } = resolved;

  let body: { category?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const category = body?.category;
  if (!isSensitiveDataCategory(category)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "category must be 'health' or 'financial'",
        },
      },
      { status: 400 },
    );
  }

  const recordedBy = { actorId: guardianId, basis: dependent.basis };
  const result = await grantSensitiveDataConsent(
    dependent.id,
    category,
    recordedBy,
  );
  if (!result.ok) {
    const message = (result.error as { message?: string } | null)?.message;
    if (message?.startsWith("NOT_GUARDIAN")) return dependentNotFoundResponse();
    return internalErrorResponse(
      `${ROUTE}: record_sensitive_data_consent failed`,
      result.error,
    );
  }

  const wording = consentWording(category, recordedBy);
  return NextResponse.json(
    {
      data: {
        category,
        basis: dependent.basis,
        version: wording.version,
        statement: wording.statement,
        changed: result.changed,
      },
    },
    { status: 200 },
  );
}

export const POST = withAuditContext("dependent.consent.grant", handlePost);
