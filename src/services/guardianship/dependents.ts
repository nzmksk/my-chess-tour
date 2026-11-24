import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { internalErrorResponse } from "@/lib/http/internal-error";
import type { ChessTitle, Gender, OkuStatus } from "@/app/profile/types";

const MAX_ACTIVE_DEPENDENTS = 10;

export const MAX_DEPENDENT_NAME_LENGTH = 100;

export const CONTACT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const GUARDIANSHIP_RELATIONSHIPS = [
  "parent",
  "legal_guardian",
  "carer",
  "coach",
  "other",
] as const;
export type GuardianshipRelationship =
  (typeof GUARDIANSHIP_RELATIONSHIPS)[number];

export const MINOR_RELATIONSHIPS: readonly GuardianshipRelationship[] = [
  "parent",
  "legal_guardian",
];

export const GUARDIANSHIP_BASES = ["minor", "authorised", "appointed"] as const;
export type GuardianshipBasis = (typeof GUARDIANSHIP_BASES)[number];

type AuthorisationMethod =
  | "player_invite"
  | "guardian_attestation"
  | "document";

interface DependentProfile {
  date_of_birth: string | null;
  gender: Gender | null;
  nationality: string | null;
  fide_id: number | null;
  mcf_id: number | null;
  title: ChessTitle | null;
  national_rating: number | null;
  oku_status: OkuStatus;
}

export interface DependentView extends DependentProfile {
  id: string;
  guardianship_id: string;
  first_name: string;
  last_name: string;
  account_type: "self" | "managed";
  contact_email: string | null;
  relationship: GuardianshipRelationship;
  basis: GuardianshipBasis;
  authorisation_method: AuthorisationMethod | null;
  terms_version: string;
  terms_accepted_at: string;
  added_at: string;
}

interface DependentRow {
  id: string;
  relationship: GuardianshipRelationship;
  basis: GuardianshipBasis;
  authorisation_method: AuthorisationMethod | null;
  terms_version: string;
  terms_accepted_at: string;
  created_at: string;
  dependent: {
    id: string;
    first_name: string;
    last_name: string;
    account_type: "self" | "managed";
    contact_email: string | null;
    player_profiles:
      | Partial<DependentProfile>
      | Partial<DependentProfile>[]
      | null;
  } | null;
}

const DEPENDENT_SELECT = `id, relationship, basis, authorisation_method,
  terms_version, terms_accepted_at, created_at,
  dependent:users!dependent_user_id(id, first_name, last_name, account_type, contact_email,
    player_profiles(date_of_birth, gender, nationality, fide_id, mcf_id, title, national_rating, oku_status))`;

function toDependentView(row: DependentRow): DependentView | null {
  if (!row.dependent) return null;
  const profiles = row.dependent.player_profiles;
  const profile = (Array.isArray(profiles) ? profiles[0] : profiles) ?? {};
  return {
    id: row.dependent.id,
    guardianship_id: row.id,
    first_name: row.dependent.first_name,
    last_name: row.dependent.last_name,
    account_type: row.dependent.account_type,
    contact_email: row.dependent.contact_email,
    relationship: row.relationship,
    basis: row.basis,
    authorisation_method: row.authorisation_method,
    terms_version: row.terms_version,
    terms_accepted_at: row.terms_accepted_at,
    added_at: row.created_at,
    date_of_birth: profile.date_of_birth ?? null,
    gender: profile.gender ?? null,
    nationality: profile.nationality ?? null,
    fide_id: profile.fide_id ?? null,
    mcf_id: profile.mcf_id ?? null,
    title: profile.title ?? null,
    national_rating: profile.national_rating ?? null,
    oku_status: profile.oku_status ?? "none",
  };
}

export type LoadResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: unknown };

export async function listDependents(
  guardianId: string,
): Promise<LoadResult<DependentView[]>> {
  const { data, error } = await supabaseAdmin
    .from("guardianships")
    .select(DEPENDENT_SELECT)
    .eq("guardian_user_id", guardianId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error };
  return {
    ok: true,
    data: ((data ?? []) as unknown as DependentRow[])
      .map(toDependentView)
      .filter((view): view is DependentView => view !== null),
  };
}

export async function getDependent(
  guardianId: string,
  dependentId: string,
): Promise<LoadResult<DependentView | null>> {
  const { data, error } = await supabaseAdmin
    .from("guardianships")
    .select(DEPENDENT_SELECT)
    .eq("guardian_user_id", guardianId)
    .eq("dependent_user_id", dependentId)
    .eq("status", "active")
    .maybeSingle();
  if (error) return { ok: false, error };
  return {
    ok: true,
    data: data ? toDependentView(data as unknown as DependentRow) : null,
  };
}

export function dependentNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Dependent not found" } },
    { status: 404 },
  );
}

export function dependentErrorResponse(
  error: { code?: string; message: string },
  action: string,
): NextResponse {
  const respond = (code: string, message: string, status: number) =>
    NextResponse.json({ error: { code, message } }, { status });
  const is = (sentinel: string) => error.message.startsWith(sentinel);

  if (is("DEPENDENT_NOT_FOUND")) return dependentNotFoundResponse();
  if (is("DEPENDENT_EXISTS")) {
    return respond(
      "DEPENDENT_EXISTS",
      "This dependent is already on your account.",
      409,
    );
  }
  if (is("DEPENDENT_HAS_PENDING_PAYMENT")) {
    return respond(
      "PENDING_PAYMENT",
      "This dependent has a registration waiting for payment. Finish or cancel that checkout before removing them.",
      422,
    );
  }
  if (is("GUARDIANSHIP_LIMIT_REACHED")) {
    return respond(
      "DEPENDENT_LIMIT_REACHED",
      `You can act for at most ${MAX_ACTIVE_DEPENDENTS} players at a time. Remove one before adding another.`,
      422,
    );
  }
  if (is("GUARDIAN_NOT_ELIGIBLE")) {
    return respond(
      "FORBIDDEN",
      "Only an account you sign in to yourself can add dependents.",
      403,
    );
  }
  if (is("BASIS_AGE_MISMATCH")) {
    return respond(
      "BASIS_AGE_MISMATCH",
      "A dependent under 18 must be added as a minor, and one aged 18 or over as an adult.",
      422,
    );
  }
  if (is("BASIS_NOT_SUPPORTED")) {
    return respond(
      "BASIS_NOT_SUPPORTED",
      "Appointed guardianships aren't available yet. Contact support.",
      422,
    );
  }
  if (is("INVALID_DEPENDENT")) {
    return respond(
      "VALIDATION_ERROR",
      "Some of the dependent's details are missing or invalid.",
      400,
    );
  }
  return internalErrorResponse(`Dependents: unexpected error ${action}`, error);
}
