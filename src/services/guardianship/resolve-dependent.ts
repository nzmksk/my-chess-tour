import { NextResponse } from "next/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { UUID_RE } from "@/app/api/v1/organizations/_lib/authorize-org";
import {
  dependentNotFoundResponse,
  getDependent,
  type DependentView,
} from "@/services/guardianship/dependents";

export type ResolvedDependent =
  | { ok: true; guardianId: string; dependent: DependentView }
  | { ok: false; response: NextResponse };

export async function resolveDependentForCaller(
  dependentId: string,
  logLabel: string,
): Promise<ResolvedDependent> {
  const claims = await getAuthClaims();
  if (!claims) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: { code: "UNAUTHORIZED", message: "Authentication required" },
        },
        { status: 401 },
      ),
    };
  }

  if (!UUID_RE.test(dependentId)) {
    return { ok: false, response: dependentNotFoundResponse() };
  }

  const result = await getDependent(claims.id, dependentId);
  if (!result.ok) {
    return {
      ok: false,
      response: internalErrorResponse(
        `${logLabel}: lookup failed`,
        result.error,
      ),
    };
  }
  if (!result.data) {
    return { ok: false, response: dependentNotFoundResponse() };
  }
  return { ok: true, guardianId: claims.id, dependent: result.data };
}
