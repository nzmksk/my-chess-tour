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

// The separate consent checkbox for health or financial data (#451). Its label
// is the consent statement from legal.ts, word for word, because the version
// recorded with the grant is the version of that text. Never pre-ticked, and
// never folded into another checkbox: bundled or default-on consent is not the
// explicit consent the PDPA asks for.
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

/**
 * Record the user's consent before the data is sent. The database refuses an
 * OKU upload or a bank-details save without it, so a failure here must stop
 * the submission. Returns an error message, or null on success.
 */
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
