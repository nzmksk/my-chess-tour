import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { enforceRateLimit } from "@/services/rate-limit/limiter";
import { withAuditContext } from "@/services/supabase/audit-context";
import { internalErrorResponse } from "@/lib/http/internal-error";
import {
  UNDER_18_SELF_ACCOUNT_MESSAGE,
  isUnderAdultAge,
} from "@/lib/auth/adult-age";
import { UUID_RE } from "@/app/api/v1/organizations/_lib/authorize-org";
import {
  resolveNewFideId,
  validateProfileFields,
} from "@/services/profile/profile-fields";
import {
  CONTACT_EMAIL_RE,
  dependentErrorResponse,
  dependentNotFoundResponse,
  getDependent,
  type DependentView,
} from "@/services/guardianship/dependents";

type RouteContext = { params: Promise<{ id: string }> };

type Resolved =
  | { ok: true; guardianId: string; dependent: DependentView }
  | { ok: false; response: NextResponse };

async function resolveDependent(
  context: RouteContext,
  action: string,
): Promise<Resolved> {
  const { id } = await context.params;

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

  if (!UUID_RE.test(id)) {
    return { ok: false, response: dependentNotFoundResponse() };
  }

  const result = await getDependent(claims.id, id);
  if (!result.ok) {
    return {
      ok: false,
      response: internalErrorResponse(
        `${action} /api/v1/me/dependents/[id]: lookup failed`,
        result.error,
      ),
    };
  }
  if (!result.data) {
    return { ok: false, response: dependentNotFoundResponse() };
  }
  return { ok: true, guardianId: claims.id, dependent: result.data };
}

async function handleGet(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const resolved = await resolveDependent(context, "GET");
  if (!resolved.ok) return resolved.response;
  return NextResponse.json({ data: resolved.dependent });
}

async function handlePatch(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const resolved = await resolveDependent(context, "PATCH");
  if (!resolved.ok) return resolved.response;
  const { guardianId, dependent } = resolved;

  const limited = await enforceRateLimit("dependentSave", request, guardianId);
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Body must be a JSON object",
        },
      },
      { status: 400 },
    );
  }

  const { update, errors } = validateProfileFields(body, dependent);

  let contactEmailUpdate: { value: string | null } | null = null;
  if ("contact_email" in body) {
    const raw = body.contact_email;
    const email = typeof raw === "string" ? raw.trim().toLowerCase() : null;
    if (dependent.account_type !== "managed" || dependent.basis === "minor") {
      errors.push(
        "contact_email can only be set for a dependent aged 18 or over who has no login",
      );
    } else if (raw === null || email === "") {
      contactEmailUpdate = { value: null };
    } else if (email && CONTACT_EMAIL_RE.test(email) && email.length <= 255) {
      contactEmailUpdate = { value: email };
    } else {
      errors.push("contact_email must be a valid email address or null");
    }
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: errors.join("; ") } },
      { status: 400 },
    );
  }

  if (
    dependent.account_type === "self" &&
    update.date_of_birth != null &&
    update.date_of_birth !== dependent.date_of_birth &&
    isUnderAdultAge(update.date_of_birth)
  ) {
    return NextResponse.json(
      { error: { code: "UNDER_18", message: UNDER_18_SELF_ACCOUNT_MESSAGE } },
      { status: 422 },
    );
  }

  if (Object.keys(update).length === 0 && contactEmailUpdate === null) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "No valid fields provided",
        },
      },
      { status: 400 },
    );
  }

  let fideFields = {};
  if (update.fide_id != null && update.fide_id !== dependent.fide_id) {
    const fide = await resolveNewFideId(
      request,
      guardianId,
      update.fide_id,
      async () => dependent,
    );
    if (!fide.ok) return fide.response;
    fideFields = fide.fields;
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabaseAdmin
      .from("player_profiles")
      .upsert(
        { user_id: dependent.id, ...update, ...fideFields },
        { onConflict: "user_id" },
      );
    if (error) {
      return internalErrorResponse(
        "PATCH /api/v1/me/dependents/[id]: profile update failed",
        error,
      );
    }
  }

  if (contactEmailUpdate !== null) {
    const { error } = await supabaseAdmin
      .from("users")
      .update({ contact_email: contactEmailUpdate.value })
      .eq("id", dependent.id)
      .eq("account_type", "managed");
    if (error) {
      return internalErrorResponse(
        "PATCH /api/v1/me/dependents/[id]: contact email update failed",
        error,
      );
    }
  }

  const refreshed = await getDependent(guardianId, dependent.id);
  if (!refreshed.ok || !refreshed.data) {
    return internalErrorResponse(
      "PATCH /api/v1/me/dependents/[id]: updated dependent could not be read back",
      refreshed.ok ? undefined : refreshed.error,
    );
  }
  return NextResponse.json({ data: refreshed.data });
}

interface UpcomingRegistration {
  registration_id: string;
  tournament_id: string;
  tournament_name: string;
  start_date: string;
}

async function handleDelete(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const resolved = await resolveDependent(context, "DELETE");
  if (!resolved.ok) return resolved.response;
  const { guardianId, dependent } = resolved;

  const limited = await enforceRateLimit("dependentSave", request, guardianId);
  if (limited) return limited;

  const { data, error } = await supabaseAdmin.rpc("revoke_dependent", {
    p_guardian_user_id: guardianId,
    p_dependent_user_id: dependent.id,
  });
  if (error) return dependentErrorResponse(error, "revoking a dependent");

  const upcoming =
    (data as { upcoming_registrations?: UpcomingRegistration[] })
      .upcoming_registrations ?? [];

  return NextResponse.json({
    data: {
      id: dependent.id,
      revoked: true,
      upcoming_registrations: upcoming,
      warning:
        upcoming.length > 0
          ? `${dependent.first_name} is still registered for ${upcoming.length} upcoming ${upcoming.length === 1 ? "tournament" : "tournaments"}. Those registrations stay in place; you can no longer manage them.`
          : null,
    },
  });
}

export const GET = handleGet;
export const PATCH = withAuditContext("dependent.update", handlePatch);
export const DELETE = withAuditContext("dependent.revoke", handleDelete);
