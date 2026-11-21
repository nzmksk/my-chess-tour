import { supabaseAdmin } from "@/services/supabase/admin";

export interface UploadConstraints {
  maxBytes: number;
  mimeTypes: readonly string[];
}

export type UploadCheck = { ok: true } | { ok: false; reason: string };

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

  if (!data.contentType || !mimeTypes.includes(data.contentType)) {
    return {
      ok: false,
      reason: `unsupported file type (allowed: ${mimeTypes.join(", ")})`,
    };
  }

  return { ok: true };
}

const LIST_PAGE_SIZE = 1000;

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
