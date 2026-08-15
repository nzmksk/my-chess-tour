import { NextResponse } from "next/server";
import { validateEmail } from "@/services/auth/auth-validation";
import { BANK_SWIFT_CODES } from "@/lib/malaysian-banks";
import { validateOrgLinks, type OrgLink } from "../_lib/org-fields";

export type OrgEntityType = "company" | "society" | "individual";

export type OrgDocumentType =
  | "ssm"
  | "ros"
  | "authorization_letter"
  | "identity_document"
  | "other";

const ENTITY_TYPES: readonly OrgEntityType[] = [
  "company",
  "society",
  "individual",
];

const DOCUMENT_TYPES: readonly OrgDocumentType[] = [
  "ssm",
  "ros",
  "authorization_letter",
  "identity_document",
  "other",
];

/** At most this many KYB documents per application — a bound, not a target. */
const MAX_DOCUMENTS = 10;

export interface OrgDocumentInput {
  doc_type: OrgDocumentType;
  storage_path: string;
  original_filename: string | null;
}

// Deliberately no agreement_version field. The applicant declares that they
// accept the Organizer Agreement; WHICH version that acceptance is recorded
// against is decided by the server from src/lib/legal.ts. Because this shape is
// what the route inserts, a version in the request body cannot reach the
// database even by accident.
//
// Likewise no bank_name: the client sends a SWIFT code and the server derives
// the display name from src/lib/malaysian-banks.ts, so the two cannot disagree.
export interface ApplyRequest {
  name: string;
  description?: string | null;
  links?: OrgLink[] | null;
  email: string;
  phone?: string | null;
  past_tournament_refs?: string | null;
  entity_type: OrgEntityType;
  registration_number: string | null;
  bank_code: string;
  bank_account_holder: string;
  bank_account_number: string;
  documents: OrgDocumentInput[];
}

function invalid(message: string): { error: NextResponse } {
  return {
    error: NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message } },
      { status: 400 },
    ),
  };
}

/**
 * Where this user's KYB uploads are allowed to live.
 *
 * User-scoped rather than org-scoped because the organization does not exist
 * until this request creates it — see the bucket comment in
 * 005_bucket_policies.sql.
 */
export function orgDocumentPrefix(appUserId: string): string {
  return `users/${appUserId}/org-kyb/`;
}

/**
 * @param body   parsed request body
 * @param appUserId the CALLER's public.users.id, from the session — never from
 *   the body. It is what the document paths are checked against.
 */
export function validateApplyRequest(
  body: unknown,
  appUserId: string,
): { data: ApplyRequest } | { error: NextResponse } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return invalid("Invalid request body");
  }

  const b = body as Record<string, unknown>;

  if (!b.name || typeof b.name !== "string" || b.name.trim() === "") {
    return invalid("Organization name is required");
  }

  if (!b.email || typeof b.email !== "string" || b.email.trim() === "") {
    return invalid("Email is required");
  }

  if (!validateEmail(b.email as string)) {
    return invalid("Invalid email address");
  }

  // The agreement governs money movement and carries a claw-back obligation, so
  // an application without an explicit acceptance is not an application.
  if (b.agreement_accepted !== true) {
    return invalid("You must accept the Organizer Agreement");
  }

  const linksError = validateOrgLinks(b.links);
  if (linksError) return invalid(linksError);

  // ---- Payout bank account -------------------------------------------------
  // An unknown SWIFT code is one CHIP Send will not recognise either, so it is
  // rejected here rather than becoming a failed payout later.
  if (typeof b.bank_code !== "string" || !BANK_SWIFT_CODES.has(b.bank_code)) {
    return invalid("Please choose your bank from the list");
  }

  if (
    typeof b.bank_account_holder !== "string" ||
    b.bank_account_holder.trim() === ""
  ) {
    return invalid("Account holder name is required");
  }

  if (b.bank_account_holder.trim().length > 255) {
    return invalid("Account holder name must be 255 characters or fewer");
  }

  // Same normalization as PATCH /api/v1/profile/banking: strip the spaces and
  // dashes people copy off a bank statement, then require digits only.
  if (typeof b.bank_account_number !== "string") {
    return invalid("Account number is required");
  }
  const accountNumber = b.bank_account_number.replace(/[\s-]/g, "");
  if (!/^\d{5,20}$/.test(accountNumber)) {
    return invalid(
      "Account number must contain 5 to 20 digits (spaces and dashes allowed)",
    );
  }

  // ---- Entity identity -----------------------------------------------------
  if (
    typeof b.entity_type !== "string" ||
    !ENTITY_TYPES.includes(b.entity_type as OrgEntityType)
  ) {
    return invalid("Please choose the type of entity you are applying as");
  }
  const entityType = b.entity_type as OrgEntityType;

  const registrationNumber =
    typeof b.registration_number === "string"
      ? b.registration_number.trim() || null
      : null;

  if (entityType !== "individual" && !registrationNumber) {
    return invalid(
      entityType === "company"
        ? "An SSM registration number is required"
        : "An ROS registration number is required",
    );
  }

  if (registrationNumber && registrationNumber.length > 100) {
    return invalid("Registration number must be 100 characters or fewer");
  }

  // ---- Verification documents ----------------------------------------------
  if (!Array.isArray(b.documents) || b.documents.length === 0) {
    return invalid("At least one verification document is required");
  }

  if (b.documents.length > MAX_DOCUMENTS) {
    return invalid(`At most ${MAX_DOCUMENTS} documents can be submitted`);
  }

  const allowedPrefix = orgDocumentPrefix(appUserId);
  const documents: OrgDocumentInput[] = [];

  for (const entry of b.documents) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return invalid("Each document must be an object");
    }

    const d = entry as Record<string, unknown>;

    if (
      typeof d.doc_type !== "string" ||
      !DOCUMENT_TYPES.includes(d.doc_type as OrgDocumentType)
    ) {
      return invalid("Each document must have a valid type");
    }

    // SECURITY-CRITICAL. Storage RLS stops a user writing outside their own
    // folder; nothing stops them CLAIMING a path they did not write. Without
    // this check a client can register any object in the bucket — including
    // another applicant's identity document — as its own, and the admin review
    // page will happily mint a signed URL for it. The `..` guard is belt and
    // braces against a traversal that resolves back out of the prefix.
    if (
      typeof d.storage_path !== "string" ||
      !d.storage_path.startsWith(allowedPrefix) ||
      d.storage_path.includes("..")
    ) {
      return invalid("Each document must point to your own uploaded file");
    }

    documents.push({
      doc_type: d.doc_type as OrgDocumentType,
      storage_path: d.storage_path,
      original_filename:
        typeof d.original_filename === "string"
          ? d.original_filename.slice(0, 255) || null
          : null,
    });
  }

  // Mirrors the rule create_organization_application enforces in-transaction.
  // Checked here too so the applicant gets a readable message naming the
  // document they're missing, rather than a generic RPC failure.
  const hasRegistryDoc = documents.some(
    (d) => d.doc_type === "ssm" || d.doc_type === "ros",
  );
  const hasIdentityDoc = documents.some(
    (d) =>
      d.doc_type === "identity_document" ||
      d.doc_type === "authorization_letter",
  );

  if (entityType !== "individual" && !hasRegistryDoc) {
    return invalid(
      entityType === "company"
        ? "An SSM document is required for a company"
        : "An ROS document is required for a society",
    );
  }

  if (entityType === "individual" && !hasIdentityDoc) {
    return invalid(
      "An identity document or authorization letter is required for an individual organizer",
    );
  }

  return {
    data: {
      name: b.name.trim(),
      description:
        typeof b.description === "string" ? b.description.trim() || null : null,
      links:
        Array.isArray(b.links) && b.links.length > 0
          ? (b.links as OrgLink[])
          : null,
      email: (b.email as string).trim(),
      phone: typeof b.phone === "string" ? b.phone.trim() || null : null,
      past_tournament_refs:
        typeof b.past_tournament_refs === "string"
          ? b.past_tournament_refs.trim() || null
          : null,
      entity_type: entityType,
      // An individual has no registry entry; normalised away so the column
      // means exactly one thing (the RPC does the same).
      registration_number:
        entityType === "individual" ? null : registrationNumber,
      bank_code: b.bank_code,
      bank_account_holder: b.bank_account_holder.trim(),
      bank_account_number: accountNumber,
      documents,
    },
  };
}
