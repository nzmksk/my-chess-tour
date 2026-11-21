"use client";

import {
  currentConsent,
  type SensitiveDataCategory,
} from "@/lib/reference/legal";

interface Props {
  category: SensitiveDataCategory;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export default function SensitiveDataConsent({
  category,
  checked,
  onChange,
  disabled,
}: Props) {
  const id = `sensitive-data-consent-${category}`;
  return (
    <div className="check-row">
      <input
        id={id}
        type="checkbox"
        className="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label className="check-label mb-0" htmlFor={id}>
        {currentConsent(category).statement}{" "}
        <a href="/privacy" target="_blank" rel="noopener noreferrer">
          Privacy Policy
        </a>
      </label>
    </div>
  );
}

export async function recordSensitiveDataConsent(
  category: SensitiveDataCategory,
): Promise<string | null> {
  try {
    const res = await fetch("/api/v1/profile/consents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category }),
    });
    if (res.ok) return null;
    const json = await res.json().catch(() => null);
    return (
      json?.error?.message ??
      "We couldn't record your consent. Please try again."
    );
  } catch {
    return "A network error occurred. Please try again.";
  }
}
