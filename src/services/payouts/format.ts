// Money and database-refusal formatting shared by the payout routes and pages.
// Pure, so client components can use it too.

/** 123456 -> "RM 1,234.56". */
export function formatRinggit(cents: number): string {
  return `RM ${(cents / 100).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The payout functions raise "SENTINEL: detail" (007_payment_functions.sql).
 * Returns both halves, or null for a message without a sentinel.
 */
export function parseSentinel(
  message: string | null | undefined,
): { sentinel: string; detail: string } | null {
  if (!message) return null;
  const match = message.match(/^([A-Z][A-Z0-9_]+): ([\s\S]*)$/);
  return match ? { sentinel: match[1], detail: match[2] } : null;
}
