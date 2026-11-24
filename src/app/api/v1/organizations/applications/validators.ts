import { NextResponse } from "next/server";
import { validateEmail } from "@/services/auth/auth-validation";
import { validateOrgLinks, type OrgLink } from "../_lib/org-fields";

type OrgEntityType = "company" | "society" | "individual";

type OrgDocumentType =
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OrgDocumentInput {
  doc_type: OrgDocumentType;
  storage_path: string;
  original_filename: string | null;
}

/** The organization's own details: the same on a first submission and an amendment. */
interface OrgFields {
  name: string;
  description: string | null;
  links: OrgLink[] | null;
  email: string;
  phone: string | null;
  past_tournament_refs: string | null;
  entity_type: OrgEntityType;
  registration_number: string | null;
  registered_name: string;
}

// Deliberately no agreement_version field. The applicant declares that they
// accept the Organizer Agreement; WHICH version that acceptance is recorded
// against is decided by the server from src/lib/reference/legal.ts. Because this shape is
// what the route inserts, a version in the request body cannot reach the
// database even by accident.
export interface ApplyRequest extends OrgFields {
  documents: OrgDocumentInput[];
}

/**
 * An amendment of a rejected application (#582). The applicant keeps the
 * listed documents while adding `new_documents`. The documents left out are
 * removed.
 */
export interface ResubmitRequest extends OrgFields {
  keep_document_ids: string[];
  new_documents: OrgDocumentInput[];
}

type Validated<T> = { data: T } | { error: NextResponse };

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
function orgDocumentPrefix(appUserId: string): string {
  return `users/${appUserId}/org-kyb/`;
}

function asObject(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function validateOrgFields(b: Record<string, unknown>): Validated<OrgFields> {
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
  // an application without an explicit acceptance is not an application. An
  // amendment accepts it again: the version may have changed since.
  if (b.agreement_accepted !== true) {
    return invalid("You must accept the Organizer Agreement");
  }

  const linksError = validateOrgLinks(b.links);
  if (linksError) return invalid(linksError);

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

  const registeredName =
    typeof b.registered_name === "string"
      ? b.registered_name.trim().replace(/\s+/g, " ")
      : "";
  if (!registeredName) {
    return invalid(
      entityType === "individual"
        ? "Your full name as on your identity document is required"
        : `The registered name on your ${entityType === "company" ? "SSM" : "ROS"} registration is required`,
    );
  }
  if (registeredName.length > 255) {
    return invalid("Registered name must be 255 characters or fewer");
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
      registered_name: registeredName,
    },
  };
}

function validateDocuments(
  value: unknown,
  appUserId: string,
): Validated<OrgDocumentInput[]> {
  if (!Array.isArray(value)) {
    return invalid("Documents must be a list");
  }

  if (value.length > MAX_DOCUMENTS) {
    return invalid(`At most ${MAX_DOCUMENTS} documents can be submitted`);
  }

  const allowedPrefix = orgDocumentPrefix(appUserId);
  const documents: OrgDocumentInput[] = [];

  for (const entry of value) {
    const d = asObject(entry);
    if (!d) {
      return invalid("Each document must be an object");
    }

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

  return { data: documents };
}

/**
 * Mirrors the rule the application RPCs enforce in-transaction. Checked here
 * too so the applicant gets a readable message naming the document they're
 * missing, rather than a generic RPC failure. The registry that matches the
 * entity, not either one: a company is registered with SSM and a society with
 * ROS.
 */
function missingEntityDocument(
  entityType: OrgEntityType,
  docTypes: string[],
): string | null {
  if (entityType === "individual") {
    return docTypes.some(
      (t) => t === "identity_document" || t === "authorization_letter",
    )
      ? null
      : "An identity document or authorization letter is required for an individual organizer";
  }
  if (entityType === "company") {
    return docTypes.includes("ssm")
      ? null
      : "An SSM document is required for a company";
  }
  return docTypes.includes("ros")
    ? null
    : "An ROS document is required for a society";
}

/**
 * @param body   parsed request body
 * @param appUserId the CALLER's public.users.id, from the session — never from
 *   the body. It is what the document paths are checked against.
 */
export function validateApplyRequest(
  body: unknown,
  appUserId: string,
): Validated<ApplyRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const fields = validateOrgFields(b);
  if ("error" in fields) return fields;

  if (!Array.isArray(b.documents) || b.documents.length === 0) {
    return invalid("At least one verification document is required");
  }
  const documents = validateDocuments(b.documents, appUserId);
  if ("error" in documents) return documents;

  const missing = missingEntityDocument(
    fields.data.entity_type,
    documents.data.map((d) => d.doc_type),
  );
  if (missing) return invalid(missing);

  return {
    data: { ...fields.data, documents: documents.data },
  };
}

/**
 * Validates an amendment of a rejected application (#582). The entity rule is
 * checked by the RPC, which is the only place that knows the types of the kept
 * documents.
 *
 * @param appUserId the CALLER's public.users.id, from the session.
 */
export function validateResubmitRequest(
  body: unknown,
  appUserId: string,
): Validated<ResubmitRequest> {
  const b = asObject(body);
  if (!b) return invalid("Invalid request body");

  const fields = validateOrgFields(b);
  if ("error" in fields) return fields;

  const keep = b.keep_document_ids ?? [];
  if (
    !Array.isArray(keep) ||
    !keep.every((id) => typeof id === "string" && UUID_RE.test(id))
  ) {
    return invalid("Kept documents must be a list of document ids");
  }

  const newDocuments = validateDocuments(b.new_documents ?? [], appUserId);
  if ("error" in newDocuments) return newDocuments;

  if (keep.length + newDocuments.data.length === 0) {
    return invalid("At least one verification document is required");
  }
  if (keep.length + newDocuments.data.length > MAX_DOCUMENTS) {
    return invalid(`At most ${MAX_DOCUMENTS} documents can be submitted`);
  }

  return {
    data: {
      ...fields.data,
      keep_document_ids: keep as string[],
      new_documents: newDocuments.data,
    },
  };
}
