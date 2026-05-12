"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { TournamentDetail } from "../../types";
import { formatRm, toTitleCase, formatDeadline } from "@/app/tournaments/utils";
import type { RegistrationRow, PlayerProfile } from "../types";

const PROCESSING_FEE_CENTS = 150;

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
    const age = Math.floor(
      (now.getTime() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365.25),
    );
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
}

type FormStatus = "idle" | "submitting" | "success" | "error";

export default function RegisterForm({ tournament, playerProfile }: Props) {
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
  const total = selected.amount_cents + PROCESSING_FEE_CENTS;

  const eligibilityError = useMemo<string | null>(() => {
    if (selected.expired) return "This fee tier has expired.";
    return checkEligibility(selected, playerProfile, now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, playerProfile]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "submitting" || eligibilityError) return;
    setStatus("submitting");
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/v1/tournaments/${tournament.id}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fee_tier: selectedTier }),
      });
      const json = await res.json();
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
      <div className="max-w-lg mx-auto">
        <div className="card card--featured p-8 flex flex-col text-center">
          <div className="confirm-icon">♟</div>
          <h2 className="confirm-title">Registration Submitted</h2>
          <p className="confirm-body">
            Your spot is reserved. Your registration is pending payment
            confirmation.
          </p>
          <div className="session-info text-left mt-2">
            <div className="session-row">
              <span className="session-key">Reference</span>
              <span className="session-val font-mono text-xs">
                {registration.id}
              </span>
            </div>
            <div className="session-row">
              <span className="session-key">Fee Tier</span>
              <span className="session-val">
                {toTitleCase(registration.fee_tier)}
              </span>
            </div>
            <div className="session-row">
              <span className="session-key">Status</span>
              <span className="session-val text-amber-400">
                Pending Payment
              </span>
            </div>
          </div>
          <Link
            href={`/tournaments/${tournament.id}`}
            className="btn-secondary rounded-md text-center mt-2"
          >
            Back to Tournament
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="font-cinzel text-xl font-semibold text-text-primary tracking-wider mb-4">
        Register — {tournament.name}
      </h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Fee tier selector */}
        <div className="card card--featured p-6 flex flex-col gap-3">
          <p className="font-cinzel text-xs font-semibold uppercase tracking-widest text-text-muted">
            Select Entry Fee
          </p>

          <div className="relative">
            <select
              value={selectedTier}
              onChange={(e) => setSelectedTier(e.target.value)}
              className="w-full appearance-none border border-border bg-bg-raised rounded-md px-3 py-2.5 pr-8 font-lato text-sm text-text-primary focus:outline-none focus:border-gold-bright transition-colors cursor-pointer"
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
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-xs">
              ▾
            </span>
          </div>

          {selected.subtitle && !eligibilityError && (
            <p className="font-lato text-xs text-text-muted">
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
        <div className="card p-6 flex flex-col gap-2">
          <p className="font-cinzel text-xs font-semibold uppercase tracking-widest text-text-muted mb-1">
            Summary
          </p>
          <div className="flex justify-between font-lato text-sm text-text-secondary">
            <span>Entry Fee ({toTitleCase(selected.label)})</span>
            <span>
              {selected.amount_cents === 0
                ? "Free"
                : formatRm(selected.amount_cents)}
            </span>
          </div>
          <div className="flex justify-between font-lato text-sm text-text-secondary">
            <span>Processing Fee</span>
            <span>{formatRm(PROCESSING_FEE_CENTS)}</span>
          </div>
          <div className="flex justify-between font-cinzel text-sm font-bold text-text-primary border-t border-border pt-2 mt-1">
            <span>Total</span>
            <span>{formatRm(total)}</span>
          </div>
        </div>

        {/* Payment method */}
        <div className="card p-6 flex flex-col gap-3">
          <p className="font-cinzel text-xs font-semibold uppercase tracking-widest text-text-muted">
            Payment Method
          </p>
          <div className="grid grid-cols-2 gap-3">
            {PAYMENT_METHODS.map((method) => (
              <label
                key={method.id}
                className={`flex flex-col gap-0.5 border rounded-md p-3 cursor-pointer transition-colors ${
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
                <span className="font-lato text-sm font-medium text-text-primary">
                  {method.label}
                </span>
                <span className="font-lato text-xs text-text-muted">
                  {method.description}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Error */}
        {status === "error" && errorMessage && (
          <p className="font-lato text-sm text-red-400 text-center">
            {errorMessage}
          </p>
        )}

        {/* Submit */}
        <button
          type="submit"
          className="btn-primary rounded-md w-full"
          disabled={status === "submitting" || !!eligibilityError}
        >
          {status === "submitting" ? "Submitting…" : "Confirm & Pay"}
        </button>

        <Link
          href={`/tournaments/${tournament.id}`}
          className="font-lato text-sm text-text-muted text-center hover:text-text-secondary transition-colors"
        >
          ← Back to tournament
        </Link>
      </form>
    </div>
  );
}
