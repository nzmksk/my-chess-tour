import { supabaseAdmin } from "@/services/supabase/admin";
import {
  currentConsent,
  onBehalfConsent,
  type ConsentBasis,
  type SensitiveDataCategory,
} from "@/lib/reference/legal";

export interface RecordedBy {
  actorId: string;
  basis: ConsentBasis;
}

export function consentWording(
  category: SensitiveDataCategory,
  recordedBy?: RecordedBy,
) {
  return recordedBy
    ? onBehalfConsent(category, recordedBy.basis)
    : currentConsent(category);
}

export type ConsentResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: unknown };

export async function grantSensitiveDataConsent(
  userId: string,
  category: SensitiveDataCategory,
  recordedBy?: RecordedBy,
): Promise<ConsentResult> {
  const { data, error } = await supabaseAdmin.rpc(
    "record_sensitive_data_consent",
    {
      p_user_id: userId,
      p_category: category,
      p_granted: true,
      p_version: consentWording(category, recordedBy).version,
      ...(recordedBy ? { p_recorded_by: recordedBy.actorId } : {}),
    },
  );
  if (error) return { ok: false, error };
  return { ok: true, changed: data === true };
}

export async function withdrawSensitiveDataConsent(
  userId: string,
  category: SensitiveDataCategory,
  recordedById?: string,
): Promise<ConsentResult> {
  const { data, error } = await supabaseAdmin.rpc(
    "record_sensitive_data_consent",
    {
      p_user_id: userId,
      p_category: category,
      p_granted: false,
      ...(recordedById && recordedById !== userId
        ? { p_recorded_by: recordedById }
        : {}),
    },
  );
  if (error) return { ok: false, error };
  return { ok: true, changed: data === true };
}

export async function hasSensitiveDataConsent(
  userId: string,
  category: SensitiveDataCategory,
): Promise<{ ok: true; granted: boolean } | { ok: false; error: unknown }> {
  const { data, error } = await supabaseAdmin.rpc(
    "has_sensitive_data_consent",
    { p_user_id: userId, p_category: category },
  );
  if (error) return { ok: false, error };
  return { ok: true, granted: data === true };
}
