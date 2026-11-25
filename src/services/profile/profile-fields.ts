import { NextResponse, type NextRequest } from "next/server";
import type { Gender, UpdateProfilePayload } from "@/app/profile/types";
import {
  buildFideProfileUpdate,
  fetchFidePlayer,
  matchesFideName,
  type FidePlayer,
} from "@/services/fide/fide";
import { enforceRateLimit } from "@/services/rate-limit/limiter";
import { SUPPORT_EMAIL } from "@/lib/reference/contact";

const VALID_GENDERS = new Set<string>(["male", "female"]);

const MAX_DB_INTEGER = 2147483647;

export const PROFILE_FIELDS_SELECT =
  "date_of_birth, gender, nationality, fide_id, mcf_id, title, national_rating";

export interface ExistingProfileFields {
  date_of_birth: string | null;
  gender: Gender | null;
  nationality: string | null;
  fide_id: number | null;
  mcf_id: number | null;
  title: string | null;
  national_rating: number | null;
}

export interface ProfileFieldsResult {
  update: UpdateProfilePayload;
  errors: string[];
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() + 1 === m &&
    dt.getUTCDate() === d
  );
}

function setOnceError(field: string): string {
  return `${field} can only be set once; contact support to change`;
}

function readPositiveInteger(
  body: Record<string, unknown>,
  field: "fide_id" | "mcf_id",
  existing: number | null | undefined,
  update: UpdateProfilePayload,
  errors: string[],
): void {
  if (!(field in body)) return;
  const value = body[field];
  if (value === null) {
    update[field] = null;
  } else if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_DB_INTEGER
  ) {
    update[field] = value;
  } else {
    errors.push(
      `${field} must be a positive integer no greater than ${MAX_DB_INTEGER} or null`,
    );
  }
  if (
    update[field] !== undefined &&
    existing != null &&
    update[field] !== existing
  ) {
    errors.push(setOnceError(field));
  }
}

export function validateProfileFields(
  body: Record<string, unknown>,
  existing: Partial<ExistingProfileFields> | null,
): ProfileFieldsResult {
  const errors: string[] = [];
  const update: UpdateProfilePayload = {};

  if ("gender" in body) {
    if (body.gender === null) {
      update.gender = null;
    } else if (
      typeof body.gender === "string" &&
      VALID_GENDERS.has(body.gender)
    ) {
      update.gender = body.gender as Gender;
    } else {
      errors.push("gender must be 'male', 'female', or null");
    }
    if (
      update.gender !== undefined &&
      existing?.gender != null &&
      update.gender !== existing.gender
    ) {
      errors.push(setOnceError("gender"));
    }
  }

  if ("title" in body && body.title !== (existing?.title ?? null)) {
    errors.push("title cannot be edited; contact support to change");
  }

  readPositiveInteger(body, "fide_id", existing?.fide_id, update, errors);
  readPositiveInteger(body, "mcf_id", existing?.mcf_id, update, errors);

  if (
    "national_rating" in body &&
    body.national_rating !== (existing?.national_rating ?? null)
  ) {
    errors.push("national_rating cannot be edited; contact support to change");
  }

  if ("date_of_birth" in body) {
    if (body.date_of_birth === null) {
      update.date_of_birth = null;
    } else if (isCalendarDate(body.date_of_birth)) {
      update.date_of_birth = body.date_of_birth;
    } else {
      errors.push(
        "date_of_birth must be a valid calendar date (YYYY-MM-DD) or null",
      );
    }
    if (
      update.date_of_birth !== undefined &&
      existing?.date_of_birth != null &&
      update.date_of_birth !== existing.date_of_birth
    ) {
      errors.push(setOnceError("date_of_birth"));
    }
  }

  if ("nationality" in body) {
    if (body.nationality === null) {
      update.nationality = null;
    } else if (
      typeof body.nationality === "string" &&
      body.nationality.trim()
    ) {
      update.nationality = body.nationality.trim();
    } else {
      errors.push("nationality must be a non-empty string or null");
    }
    if (
      update.nationality !== undefined &&
      existing?.nationality != null &&
      update.nationality !== existing.nationality
    ) {
      errors.push(setOnceError("nationality"));
    }
  }

  return { update, errors };
}

export type FideFieldsResult =
  | { ok: true; fields: Partial<ReturnType<typeof buildFideProfileUpdate>> }
  | { ok: false; response: NextResponse };

export async function resolveNewFideId(
  request: NextRequest,
  callerId: string,
  fideId: number,
  playerName: () => Promise<{ first_name: string; last_name: string } | null>,
): Promise<FideFieldsResult> {
  const limited = await enforceRateLimit("fideLookup", request, callerId);
  if (limited) return { ok: false, response: limited };

  let player: FidePlayer | null;
  try {
    player = await fetchFidePlayer(fideId);
  } catch (error) {
    console.error(
      `FIDE lookup unavailable for user %s (fide_id %d):`,
      callerId,
      fideId,
      error,
    );
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "FIDE_UNAVAILABLE",
            message:
              "We couldn't reach FIDE to check this FIDE ID. Please try again in a few minutes.",
          },
        },
        { status: 503 },
      ),
    };
  }

  if (player === null) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: `FIDE ID ${fideId} was not found on FIDE. Please check the number.`,
          },
        },
        { status: 400 },
      ),
    };
  }

  const name = await playerName();
  const firstName = name?.first_name ?? "";
  const lastName = name?.last_name ?? "";
  if (!matchesFideName(firstName, lastName, player.name)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "FIDE_NAME_MISMATCH",
            message: `FIDE ID ${fideId} is registered to ${player.name}, which doesn't match the name on this profile. Please check the number. If it is the right ID, contact ${SUPPORT_EMAIL}.`,
          },
        },
        { status: 422 },
      ),
    };
  }

  return {
    ok: true,
    fields: buildFideProfileUpdate(
      player,
      firstName,
      lastName,
      new Date().toISOString(),
    ),
  };
}
