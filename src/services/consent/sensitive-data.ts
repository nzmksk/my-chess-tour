import { supabaseAdmin } from "@/services/supabase/admin";
import {
  currentConsent,
  type SensitiveDataCategory,
} from "@/lib/reference/legal";

export type ConsentResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: unknown };

export async function grantSensitiveDataConsent(
  userId: string,
  category: SensitiveDataCategory,
): Promise<ConsentResult> {
  const { data, error } = await supabaseAdmin.rpc(
    "record_sensitive_data_consent",
    {
      p_user_id: userId,
      p_category: category,
      p_granted: true,
      p_version: currentConsent(category).version,
    },
  );
  if (error) return { ok: false, error };
  return { ok: true, changed: data === true };
}

export async function withdrawSensitiveDataConsent(
  userId: string,
  category: SensitiveDataCategory,
): Promise<ConsentResult> {
  const { data, error } = await supabaseAdmin.rpc(
    "record_sensitive_data_consent",
    {
      p_user_id: userId,
      p_category: category,
      p_granted: false,
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
