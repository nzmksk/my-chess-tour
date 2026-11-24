import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { getAuthClaims } from "@/services/supabase/permission";
import { enforceRateLimit } from "@/services/rate-limit/limiter";
import { withAuditContext } from "@/services/supabase/audit-context";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { isUnderAdultAge } from "@/lib/auth/adult-age";
import { getTodayInTimeZone } from "@/lib/tournaments/datetime";
import { TERMS_VERSION } from "@/lib/reference/legal";
import { isCalendarDate } from "@/services/profile/profile-fields";
import {
  CONTACT_EMAIL_RE,
  GUARDIANSHIP_BASES,
  GUARDIANSHIP_RELATIONSHIPS,
  MAX_DEPENDENT_NAME_LENGTH,
  MINOR_RELATIONSHIPS,
  dependentErrorResponse,
  getDependent,
  listDependents,
  type GuardianshipBasis,
  type GuardianshipRelationship,
} from "@/services/guardianship/dependents";

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
    { status: 401 },
  );
}

function validationError(message: string, status = 400): NextResponse {
  return NextResponse.json(
    { error: { code: "VALIDATION_ERROR", message } },
    { status },
  );
}

async function handleGet(): Promise<NextResponse> {
  const claims = await getAuthClaims();
  if (!claims) return unauthorized();

  const result = await listDependents(claims.id);
  if (!result.ok) {
    return internalErrorResponse(
      "GET /api/v1/me/dependents: list failed",
      result.error,
    );
  }
  return NextResponse.json({ data: result.data });
}

interface CreateDependentInput {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  relationship: GuardianshipRelationship;
  basis: GuardianshipBasis;
  gender: "male" | "female" | null;
  nationality: string | null;
  contact_email: string | null;
}

function readName(
  body: Record<string, unknown>,
  field: "first_name" | "last_name",
  errors: string[],
): string {
  const value = body[field];
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > MAX_DEPENDENT_NAME_LENGTH
  ) {
    errors.push(
      `${field} is required and must be at most ${MAX_DEPENDENT_NAME_LENGTH} characters`,
    );
    return "";
  }
  return value.trim();
}

function parseCreateBody(
  body: Record<string, unknown>,
):
  | { ok: true; input: CreateDependentInput }
  | { ok: false; response: NextResponse } {
  const errors: string[] = [];

  const first_name = readName(body, "first_name", errors);
  const last_name = readName(body, "last_name", errors);

  const date_of_birth = body.date_of_birth;
  if (!isCalendarDate(date_of_birth)) {
    errors.push("date_of_birth must be a valid calendar date (YYYY-MM-DD)");
  } else if (date_of_birth > getTodayInTimeZone()) {
    errors.push("date_of_birth can't be in the future");
  }

  const relationship = body.relationship;
  if (
    typeof relationship !== "string" ||
    !(GUARDIANSHIP_RELATIONSHIPS as readonly string[]).includes(relationship)
  ) {
    errors.push(
      `relationship must be one of: ${GUARDIANSHIP_RELATIONSHIPS.join(", ")}`,
    );
  }

  const basis = body.basis;
  if (
    typeof basis !== "string" ||
    !(GUARDIANSHIP_BASES as readonly string[]).includes(basis)
  ) {
    errors.push(`basis must be one of: ${GUARDIANSHIP_BASES.join(", ")}`);
  }

  let gender: "male" | "female" | null = null;
  if (body.gender !== undefined && body.gender !== null) {
    if (body.gender === "male" || body.gender === "female") {
      gender = body.gender;
    } else {
      errors.push("gender must be 'male', 'female', or null");
    }
  }

  let nationality: string | null = null;
  if (body.nationality !== undefined && body.nationality !== null) {
    if (typeof body.nationality === "string" && body.nationality.trim()) {
      nationality = body.nationality.trim();
    } else {
      errors.push("nationality must be a non-empty string or null");
    }
  }

  let contact_email: string | null = null;
  if (body.contact_email !== undefined && body.contact_email !== null) {
    const email =
      typeof body.contact_email === "string"
        ? body.contact_email.trim().toLowerCase()
        : "";
    if (!CONTACT_EMAIL_RE.test(email) || email.length > 255) {
      errors.push("contact_email must be a valid email address or null");
    } else {
      contact_email = email;
    }
  }

  if (body.accept_terms !== true) {
    errors.push(
      "accept_terms must be true: you accept the Terms for, or on behalf of, this player",
    );
  }

  if (errors.length > 0) {
    return { ok: false, response: validationError(errors.join("; ")) };
  }

  const input: CreateDependentInput = {
    first_name,
    last_name,
    date_of_birth: date_of_birth as string,
    relationship: relationship as GuardianshipRelationship,
    basis: basis as GuardianshipBasis,
    gender,
    nationality,
    contact_email,
  };

  if (input.basis === "appointed") {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "BASIS_NOT_SUPPORTED",
            message:
              "Appointed guardianships aren't available yet. Contact support.",
          },
        },
        { status: 422 },
      ),
    };
  }

  const isMinor = isUnderAdultAge(input.date_of_birth);
  if ((input.basis === "minor") !== isMinor) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "BASIS_AGE_MISMATCH",
            message: isMinor
              ? "A dependent under 18 must be added with basis 'minor'."
              : "A dependent aged 18 or over can't be added with basis 'minor'.",
          },
        },
        { status: 422 },
      ),
    };
  }

  if (
    input.basis === "minor" &&
    !MINOR_RELATIONSHIPS.includes(input.relationship)
  ) {
    return {
      ok: false,
      response: validationError(
        "Only a parent or legal guardian can add a dependent under 18",
        422,
      ),
    };
  }

  if (input.basis === "minor" && input.contact_email !== null) {
    return {
      ok: false,
      response: validationError(
        "Only a dependent aged 18 or over can have a contact email",
      ),
    };
  }

  if (input.basis === "authorised" && body.authorised_by_player !== true) {
    return {
      ok: false,
      response: validationError(
        "authorised_by_player must be true: confirm the player has authorised you to act for them",
      ),
    };
  }

  return { ok: true, input };
}

async function handlePost(request: NextRequest): Promise<NextResponse> {
  const claims = await getAuthClaims();
  if (!claims) return unauthorized();

  const limited = await enforceRateLimit("dependentSave", request, claims.id);
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
    return validationError("Body must be a JSON object");
  }

  const parsed = parseCreateBody(body);
  if (!parsed.ok) return parsed.response;
  const { input } = parsed;

  const { data, error } = await supabaseAdmin.rpc("create_dependent", {
    p_guardian_user_id: claims.id,
    p_first_name: input.first_name,
    p_last_name: input.last_name,
    p_date_of_birth: input.date_of_birth,
    p_relationship: input.relationship,
    p_basis: input.basis,
    p_terms_version: TERMS_VERSION,
    p_gender: input.gender,
    p_nationality: input.nationality,
    p_contact_email: input.contact_email,
  });
  if (error) return dependentErrorResponse(error, "creating a dependent");

  const created = data as { dependent_id: string; reactivated: boolean };
  const view = await getDependent(claims.id, created.dependent_id);
  if (!view.ok || !view.data) {
    return internalErrorResponse(
      "POST /api/v1/me/dependents: created dependent could not be read back",
      view.ok ? undefined : view.error,
    );
  }

  return NextResponse.json(
    { data: { ...view.data, reactivated: created.reactivated } },
    { status: created.reactivated ? 200 : 201 },
  );
}

export const GET = handleGet;
export const POST = withAuditContext("dependent.create", handlePost);
