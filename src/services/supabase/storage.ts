import { supabaseAdmin } from "@/services/supabase/admin";

export interface UploadConstraints {
  maxBytes: number;
  /** Allowed content types, as reported by storage. */
  mimeTypes: readonly string[];
}

export type UploadCheck = { ok: true } | { ok: false; reason: string };

/**
 * Verify that an object a client claims to have uploaded actually exists and is
 * within the size/type limits, before its path is recorded in the database.
 *
 * Every private-document flow here is browser→storage then a path-registration
 * POST: the file never passes through the API, so the API never sees its size
 * or type. Enforcing those in the uploader component is a UX affordance, not a
 * control — a client that skips the component can register a path to a 500MB
 * blob, or to nothing at all, and the row is then a dangling reference an admin
 * discovers only when a signed URL 404s.
 *
 * Storage RLS already stops a user WRITING outside their own folder. It cannot
 * stop them CLAIMING a path, which is why callers must ALSO check the path
 * prefix against the caller's id (see the org-document and OKU validators).
 * This function answers a different question: is there a sane file there?
 */
export async function assertUploadedObject(
  bucket: string,
  path: string,
  { maxBytes, mimeTypes }: UploadConstraints,
): Promise<UploadCheck> {
  const { data, error } = await supabaseAdmin.storage.from(bucket).info(path);

  if (error || !data) {
    return { ok: false, reason: "the uploaded file could not be found" };
  }

  if (typeof data.size === "number" && data.size > maxBytes) {
    const limitMb = Math.round(maxBytes / (1024 * 1024));
    return { ok: false, reason: `each file must be ${limitMb}MB or smaller` };
  }

  // contentType is set from the upload request. Treat a missing one as a
  // failure rather than a pass: an object with no declared type is not one we
  // put there through the normal path.
  if (!data.contentType || !mimeTypes.includes(data.contentType)) {
    return {
      ok: false,
      reason: `unsupported file type (allowed: ${mimeTypes.join(", ")})`,
    };
  }

  return { ok: true };
}
