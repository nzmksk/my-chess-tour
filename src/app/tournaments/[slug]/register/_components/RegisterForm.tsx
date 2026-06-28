"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { TournamentDetail } from "../../types";
import {
  formatRm,
  formatRmExact,
  toTitleCase,
  formatDeadline,
  calculateAge,
} from "@/app/tournaments/utils";
import type { EntryFeeBreakdown } from "@/services/payments/fees";
import type { RegistrationRow, PlayerProfile } from "../types";
import RegistrationPending from "./RegistrationPending";

/** Server-computed fee totals keyed by tier type (e.g. "standard", "junior"). */
export type FeeBreakdownByTier = Record<string, EntryFeeBreakdown>;

const PAYMENT_METHODS = [
  { id: "fpx", label: "FPX", description: "Online Banking" },
  { id: "duitnow", label: "DuitNow QR", description: "Scan & Pay" },
  { id: "card", label: "Credit / Debit Card", description: "Visa, Mastercard" },
  { id: "ewallet", label: "E-Wallet", description: "TNG, GrabPay" },
] as const;

interface TierRestrictions {
  gender?: "female";
  oku?: boolean;
  titles?: string[];
  age_min?: number;
  age_max?: number;
}

function checkEligibility(
  tier: TierRestrictions,
  playerProfile: PlayerProfile | null,
  now: Date,
): string | null {
  if (tier.gender === "female") {
    if (!playerProfile)
      return "Complete your player profile to select this tier.";
    if (playerProfile.gender !== "female")
      return "This fee is for female players only.";
  }

  if (tier.oku) {
    if (!playerProfile)
      return "Complete your player profile to select this tier.";
    if (!playerProfile.is_oku)
      return "This fee is for OKU (disabled) players only.";
  }

  if (tier.titles?.length) {
    if (!playerProfile)
      return "Complete your player profile to select this tier.";
    if (!playerProfile.title || !tier.titles.includes(playerProfile.title))
      return `This fee is for titled players only (${tier.titles.join(", ")}).`;
  }

  if (tier.age_min != null || tier.age_max != null) {
    if (!playerProfile?.date_of_birth)
      return "Complete your player profile (date of birth) to select this tier.";
    const dob = new Date(playerProfile.date_of_birth);
    const age = calculateAge(dob, now);
    if (tier.age_min != null && age < tier.age_min)
      return `You must be at least ${tier.age_min} years old for this tier.`;
    if (tier.age_max != null && age > tier.age_max)
      return `You must be ${tier.age_max} years old or younger for this tier.`;
  }

  return null;
}

interface Props {
  tournament: TournamentDetail;
  userId: string;
  playerProfile: PlayerProfile | null;
  feeBreakdown?: FeeBreakdownByTier;
}

type FormStatus = "idle" | "submitting" | "redirecting" | "success" | "error";

export default function RegisterForm({
  tournament,
  playerProfile,
  feeBreakdown = {},
}: Props) {
  const now = new Date();

  const additional = tournament.entry_fees.additional ?? [];

  const tiers = useMemo(() => {
    const raw = [
      {
        type: "standard",
        amount_cents: tournament.entry_fees.standard.amount_cents,
        label: "Standard",
        subtitle: null as string | null,
        expired: false,
        gender: undefined as "female" | undefined,
        oku: undefined as boolean | undefined,
        titles: undefined as string[] | undefined,
        age_min: undefined as number | undefined,
        age_max: undefined as number | undefined,
      },
      ...additional.map((t) => {
        const expired = !!t.valid_until && new Date(t.valid_until) < now;
        const parts: string[] = [];
        if (t.valid_until) parts.push(`until ${formatDeadline(t.valid_until)}`);
        if (t.age_min != null && t.age_max != null)
          parts.push(`age ${t.age_min}–${t.age_max}`);
        else if (t.age_min != null) parts.push(`age ${t.age_min}+`);
        else if (t.age_max != null) parts.push(`up to age ${t.age_max}`);
        if (t.gender === "female") parts.push("female only");
        if (t.oku) parts.push("OKU");
        if (t.titles?.length) parts.push(t.titles.join(", "));
        return {
          type: t.type,
          amount_cents: t.amount_cents,
          label: toTitleCase(t.type),
          subtitle: parts.length > 0 ? parts.join(" · ") : null,
          expired,
          gender: t.gender,
          oku: t.oku,
          titles: t.titles,
          age_min: t.age_min,
          age_max: t.age_max,
        };
      }),
    ];

    return raw
      .map((t) => ({
        ...t,
        eligible:
          !t.expired && checkEligibility(t, playerProfile, now) === null,
      }))
      .sort((a, b) => {
        if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
        return a.amount_cents - b.amount_cents;
      });
    // now is stable for the lifetime of this render; playerProfile is the real dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament, playerProfile]);

  const [selectedTier, setSelectedTier] = useState<string>(
    () => tiers[0]?.type ?? "standard",
  );
  const [paymentMethod, setPaymentMethod] = useState<string>("fpx");
  const [status, setStatus] = useState<FormStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [registration, setRegistration] = useState<RegistrationRow | null>(
    null,
  );

  const selected = tiers.find((t) => t.type === selectedTier) ?? tiers[0];
  const breakdown = feeBreakdown[selected.type] ?? {
    entry_cents: selected.amount_cents,
    processing_fee_cents: 0,
    gross_cents: selected.amount_cents,
  };

  const eligibilityError = useMemo<string | null>(() => {
    if (selected.expired) return "This fee tier has expired.";
    return checkEligibility(selected, playerProfile, now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, playerProfile]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "submitting" || status === "redirecting" || eligibilityError)
      return;
    setStatus("submitting");
    setErrorMessage(null);

    try {
      const res = await fetch(
        `/api/v1/tournaments/${tournament.slug}/checkout`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fee_tier: selectedTier }),
        },
      );
      const json = await res.json();
      if (res.ok && json.data?.checkout_url) {
        setStatus("redirecting");
        window.location.href = json.data.checkout_url;
        return;
      }
      if (res.ok) {
        setRegistration(json.data);
        setStatus("success");
      } else {
        setErrorMessage(
          json.error?.message ?? "Registration failed. Please try again.",
        );
        setStatus("error");
      }
    } catch {
      setErrorMessage("A network error occurred. Please try again.");
      setStatus("error");
    }
  }

  if (status === "success" && registration) {
    return (
      <RegistrationPending
        registration={registration}
        tournamentSlug={tournament.slug}
      />
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="font-cinzel text-text-primary mb-4 text-xl font-semibold tracking-wider">
        Register — {tournament.name}
      </h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Fee tier selector */}
        <div className="card card--featured flex flex-col gap-3 p-6">
          <p className="font-cinzel text-text-muted text-xs font-semibold tracking-widest uppercase">
            Select Entry Fee
          </p>

          <div className="relative">
            <select
              value={selectedTier}
              onChange={(e) => setSelectedTier(e.target.value)}
              className="border-border bg-bg-raised font-lato text-text-primary focus:border-gold-bright w-full cursor-pointer appearance-none rounded-md border px-3 py-2.5 pr-8 text-sm transition-colors focus:outline-none"
            >
              {tiers.map((tier) => (
                <option
                  key={tier.type}
                  value={tier.type}
                  disabled={!tier.eligible}
                >
                  {tier.label} —{" "}
                  {tier.amount_cents === 0
                    ? "Free"
                    : formatRm(tier.amount_cents)}
                  {tier.expired
                    ? " (Expired)"
                    : !tier.eligible
                      ? " (Ineligible)"
                      : ""}
                </option>
              ))}
            </select>
            <span className="text-text-muted pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs">
              ▾
            </span>
          </div>

          {selected.subtitle && !eligibilityError && (
            <p className="font-lato text-text-muted text-xs">
              {selected.subtitle}
            </p>
          )}

          {eligibilityError && (
            <p className="font-lato text-xs text-amber-400">
              {eligibilityError}
            </p>
          )}
        </div>

        {/* Cost breakdown */}
        <div className="card flex flex-col gap-2 p-6">
          <p className="font-cinzel text-text-muted mb-1 text-xs font-semibold tracking-widest uppercase">
            Summary
          </p>
          <div className="font-lato text-text-secondary flex justify-between text-sm">
            <span>Entry Fee ({toTitleCase(selected.label)})</span>
            <span>
              {selected.amount_cents === 0
                ? "Free"
                : formatRm(selected.amount_cents)}
            </span>
          </div>
          <div className="font-lato text-text-secondary flex justify-between text-sm">
            <span>Processing Fee</span>
            <span>{formatRmExact(breakdown.processing_fee_cents)}</span>
          </div>
          <div className="font-cinzel text-text-primary border-border mt-1 flex justify-between border-t pt-2 text-sm font-bold">
            <span>Total</span>
            <span>
              {breakdown.gross_cents === 0
                ? "Free"
                : formatRmExact(breakdown.gross_cents)}
            </span>
          </div>
        </div>

        {/* Payment method */}
        <div className="card flex flex-col gap-3 p-6">
          <p className="font-cinzel text-text-muted text-xs font-semibold tracking-widest uppercase">
            Payment Method
          </p>
          <div className="grid grid-cols-2 gap-3">
            {PAYMENT_METHODS.map((method) => (
              <label
                key={method.id}
                className={`flex cursor-pointer flex-col gap-0.5 rounded-md border p-3 transition-colors ${
                  paymentMethod === method.id
                    ? "border-gold-bright bg-bg-raised"
                    : "border-border hover:border-gold-bright/50"
                }`}
              >
                <input
                  type="radio"
                  name="payment_method"
                  value={method.id}
                  checked={paymentMethod === method.id}
                  onChange={() => setPaymentMethod(method.id)}
                  className="sr-only"
                />
                <span className="font-lato text-text-primary text-sm font-medium">
                  {method.label}
                </span>
                <span className="font-lato text-text-muted text-xs">
                  {method.description}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Error */}
        {status === "error" && errorMessage && (
          <p className="font-lato text-center text-sm text-red-400">
            {errorMessage}
          </p>
        )}

        {/* Submit */}
        <button
          type="submit"
          className="btn-primary w-full rounded-md"
          disabled={
            status === "submitting" ||
            status === "redirecting" ||
            !!eligibilityError
          }
        >
          {status === "submitting"
            ? "Submitting…"
            : status === "redirecting"
              ? "Redirecting to payment…"
              : "Confirm & Pay"}
        </button>

        <Link
          href={`/tournaments/${tournament.slug}`}
          className="font-lato text-text-muted hover:text-text-secondary text-center text-sm transition-colors"
        >
          ← Back to tournament
        </Link>
      </form>
    </div>
  );
}
