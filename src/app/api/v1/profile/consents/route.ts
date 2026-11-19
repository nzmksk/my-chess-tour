import { NextRequest, NextResponse } from "next/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { currentConsent, isSensitiveDataCategory } from "@/lib/reference/legal";
import { grantSensitiveDataConsent } from "@/services/consent/sensitive-data";

// Records the user's separate consent to the processing of their health or
// financial data (#451), from the checkbox shown beside the OKU uploader or the
// bank details form. The client calls this BEFORE uploading the card or saving
// the details: the database refuses both without a current grant.
//
// Only the category comes from the request. The version is the statement the
// server renders (legal.ts), because a version the client sends proves nothing.
//
// There is no withdrawal here on purpose. Withdrawing consent means the data
// goes too, so it happens where the data is: DELETE /api/v1/profile/oku, and
// clearing the details through PATCH /api/v1/profile/banking.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const claims = await getAuthClaims();

  if (!claims) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

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

  const result = await grantSensitiveDataConsent(claims.id, category);
  if (!result.ok) {
    return internalErrorResponse(
      "POST /api/v1/profile/consents: record_sensitive_data_consent failed",
      result.error,
    );
  }

  return NextResponse.json(
    {
      data: {
        category,
        version: currentConsent(category).version,
        changed: result.changed,
      },
    },
    { status: 200 },
  );
}
