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

// Supabase Storage lists one level at a time, at most this many entries.
const LIST_PAGE_SIZE = 1000;

/**
 * Delete every object under `prefix`, however many there are and however deep.
 *
 * `list` returns one page of one level: files, plus an entry with a null id for
 * each sub-folder. A single call is not "everything in the folder": a client
 * with an INSERT policy can upload as many files as it likes, at any depth
 * the policy's prefix check allows. So this recurses into sub-folders and, at
 * each level, lists and removes the first page until a list comes back empty.
 * Re-listing from the start works because each pass deletes what it listed.
 * A pass that removes nothing is an error, not a loop.
 *
 * Returns null once nothing is left under `prefix`, or the error that stopped
 * it. A failure part-way leaves the rest in place, so the caller can retry.
 */
export async function removeAllUnder(
  bucket: string,
  prefix: string,
): Promise<{ message: string } | null> {
  const storage = supabaseAdmin.storage.from(bucket);

  for (;;) {
    const { data, error } = await storage.list(prefix, {
      limit: LIST_PAGE_SIZE,
    });
    if (error) return error;

    const entries = data ?? [];
    const folders = entries.filter((entry) => entry.id === null);
    const files = entries.filter((entry) => entry.id !== null);

    for (const folder of folders) {
      const nested = await removeAllUnder(bucket, `${prefix}/${folder.name}`);
      if (nested) return nested;
    }

    if (files.length === 0) return null;

    const { data: removed, error: removeError } = await storage.remove(
      files.map((file) => `${prefix}/${file.name}`),
    );
    if (removeError) return removeError;
    if (!removed || removed.length === 0) {
      return { message: `no objects removed under ${prefix}` };
    }
  }
}
