export function formatRinggit(cents: number): string {
  return `RM ${(cents / 100).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function parseSentinel(
  message: string | null | undefined,
): { sentinel: string; detail: string } | null {
  if (!message) return null;
  const match = message.match(/^([A-Z][A-Z0-9_]+): ([\s\S]*)$/);
  return match ? { sentinel: match[1], detail: match[2] } : null;
}
