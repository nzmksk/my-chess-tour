import { supabaseAdmin } from "@/services/supabase/admin";
import {
  currentConsent,
  type SensitiveDataCategory,
} from "@/lib/reference/legal";

// Separate consent for health and financial data (#451), recorded in the
// append-only sensitive_data_consents log through record_sensitive_data_consent.
// The database enforces it as well: set_player_bank_account refuses bank
// details without a financial grant, and the oku-documents upload policy
// refuses a card without a health grant. These helpers are how routes write
// and read that log.

export type ConsentResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: unknown };

/**
 * Record that the user ticked the consent checkbox for `category`.
 *
 * The version comes from legal.ts on the server, never from the request: what
 * matters is which statement the server showed, and a version the client sends
 * proves nothing. Re-granting the same version writes nothing.
 */
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

/**
 * Record a withdrawal. Withdrawing what was never granted writes nothing.
 *
 * Callers delete the data first. A withdrawal recorded while the data still
 * exists would be a false record. Data deleted under a grant whose withdrawal
 * then failed to record holds nothing, and the user can withdraw again.
 */
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

/** Whether the user's newest consent row for `category` is a grant. */
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
