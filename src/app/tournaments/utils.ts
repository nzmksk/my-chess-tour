export function formatDeadline(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatRm(cents: number): string {
  if (cents === 0) return "Free";
  return `RM${(cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function toTitleCase(s: string): string {
  return s.replace(/[_\s]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
