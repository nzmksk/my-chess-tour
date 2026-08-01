"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { TournamentDetail, Restrictions } from "../../types";
import {
  formatRm,
  formatRmExact,
  toTitleCase,
  checkAgeEligibility,
  checkRatingEligibility,
  describeRatingList,
  resolvePlayerRating,
} from "@/app/tournaments/utils";
import type { RatingContext } from "@/app/tournaments/utils";
import type { EntryFeeBreakdown } from "@/services/payments/fees";
import { nationalityMatches, resolveCountry } from "@/lib/countries";
import { formatInstantDate, resolveTimeZone } from "@/lib/datetime";
import type { RegistrationRow, PlayerProfile } from "../types";
import RegistrationPending from "./RegistrationPending";
import CompleteProfilePrompt, {
  type CompletableField,
} from "./CompleteProfilePrompt";

/** Server-computed fee totals keyed by tier type (e.g. "standard", "junior"). */
export type FeeBreakdownByTier = Record<string, EntryFeeBreakdown>;

interface TierRestrictions {
  gender?: "female";
  oku?: boolean;
  titles?: string[];
  age_min?: number;
  age_max?: number;
  rating_min?: number;
  rating_max?: number;
}

/**
 * Hard eligibility: reasons the player can NEVER satisfy by filling in the prompt
 * (wrong gender, age out of range, missing OKU/title/rating). A field that is
 * simply *null* is not a hard block — it's collected via CompleteProfilePrompt and
 * surfaced by getMissingProfileFields instead.
 */
function checkHardEligibility(
  tier: TierRestrictions,
  restrictions: Restrictions | null,
  profile: PlayerProfile | null,
  startDate: Date,
  rating: RatingContext,
): string | null {
  // Gender mismatch only blocks when gender is actually set; a null gender is
  // "missing" (collectable), not ineligible.
  if (tier.gender === "female" && profile?.gender === "male")
    return "This fee is for female players only.";
  if (
    restrictions?.gender != null &&
    profile?.gender != null &&
    profile.gender !== restrictions.gender
  )
    return `This tournament is for ${restrictions.gender} players only.`;

  // Nationality mismatch is a hard block; a null nationality is collectable.
  if (
    restrictions?.nationality != null &&
    profile?.nationality != null &&
    !nationalityMatches(restrictions.nationality, profile.nationality)
  ) {
    const label =
      resolveCountry(restrictions.nationality)?.name ??
      restrictions.nationality;
    return `This tournament is for ${label} players only.`;
  }

  // OKU and titles are not self-serviceable, so a shortfall is a hard block.
  // OKU requires admin-verified status — direct the player to Settings.
  if (tier.oku && profile?.oku_status !== "verified")
    return "This fee is for verified OKU players only — get verified in Settings.";

  if (
    tier.titles?.length &&
    (!profile?.title || !tier.titles.includes(profile.title))
  )
    return `This fee is for titled players only (${tier.titles.join(", ")}).`;
  if (
    restrictions?.titles?.length &&
    (!profile?.title || !restrictions.titles.includes(profile.title))
  )
    return `This tournament is for titled players only (${restrictions.titles.join(", ")}).`;

  // Ratings are synced from FIDE/MCF rather than typed in, so a shortfall — or
  // holding no rating on the list this tournament is rated under — is a hard
  // block. Which list that is: see resolvePlayerRating.
  const ratingMin = tier.rating_min ?? restrictions?.min_rating ?? null;
  const ratingMax = tier.rating_max ?? restrictions?.max_rating ?? null;
  if (ratingMin != null || ratingMax != null) {
    const playerRating = resolvePlayerRating(profile, rating);
    const ratingResult = checkRatingEligibility(
      playerRating,
      ratingMin,
      ratingMax,
    );
    if (ratingResult === "below_min")
      return playerRating == null
        ? `This fee requires a rating of at least ${ratingMin}, and your profile has no ${describeRatingList(rating)} rating.`
        : `This fee requires a minimum rating of ${ratingMin}.`;
    if (ratingResult === "above_max")
      return `Your rating exceeds the maximum for this fee (${ratingMax}).`;
  }

  // Age only resolves once the date of birth is known; a null DOB is collectable.
  // Judged as of the tournament start date (see checkAgeEligibility), not today.
  const ageMin = tier.age_min ?? restrictions?.min_age ?? null;
  const ageMax = tier.age_max ?? restrictions?.max_age ?? null;
  if ((ageMin != null || ageMax != null) && profile?.date_of_birth) {
    const ageResult = checkAgeEligibility(
      new Date(profile.date_of_birth),
      startDate,
      ageMin,
      ageMax,
    );
    if (ageResult === "too_young")
      return `You must be at least ${ageMin} years old on the tournament start date for this tier.`;
    if (ageResult === "too_old")
      return `You must not turn ${ageMax} before the tournament start date for this tier.`;
  }

  return null;
}

/**
 * Self-serviceable profile fields this registration requires but the player hasn't
 * set yet — collected inline so the user never leaves the registration flow.
 */
function getMissingProfileFields(
  tier: TierRestrictions,
  tournament: Pick<TournamentDetail, "is_fide_rated" | "is_mcf_rated">,
  restrictions: Restrictions | null,
  profile: PlayerProfile | null,
): CompletableField[] {
  const missing = new Set<CompletableField>();

  const needsDob =
    tier.age_min != null ||
    tier.age_max != null ||
    restrictions?.min_age != null ||
    restrictions?.max_age != null;
  if (needsDob && !profile?.date_of_birth) missing.add("date_of_birth");

  const needsGender = tier.gender === "female" || restrictions?.gender != null;
  if (needsGender && !profile?.gender) missing.add("gender");

  if (restrictions?.nationality != null && !profile?.nationality)
    missing.add("nationality");

  if (tournament.is_fide_rated && profile?.fide_id == null)
    missing.add("fide_id");
  if (tournament.is_mcf_rated && profile?.mcf_id == null) missing.add("mcf_id");

  return Array.from(missing);
}

interface Props {
  tournament: TournamentDetail;
  userId: string;
  playerProfile: PlayerProfile | null;
  restrictions?: Restrictions | null;
  feeBreakdown?: FeeBreakdownByTier;
}

type FormStatus = "idle" | "submitting" | "redirecting" | "success" | "error";

export default function RegisterForm({
  tournament,
  playerProfile,
  restrictions = null,
  feeBreakdown = {},
}: Props) {
  const now = new Date();
  // Age eligibility is judged as of the tournament start date, not today (see
  // checkAgeEligibility). `now` is still used below for tier valid_until expiry.
  const startDate = new Date(tournament.start_date);

  // Profile is held in state (seeded from the server prop) so the inline
  // CompleteProfilePrompt can update it and re-run eligibility without a reload.
  const [profile, setProfile] = useState<PlayerProfile | null>(playerProfile);

  const additional = tournament.entry_fees.additional ?? [];

  // Which rating list rating-based tiers/restrictions are judged against — the
  // same context the checkout route applies server-side.
  const ratingContext: RatingContext = {
    formatType: tournament.format.type,
    isFideRated: tournament.is_fide_rated,
    isMcfRated: tournament.is_mcf_rated,
  };

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
        rating_min: undefined as number | undefined,
        rating_max: undefined as number | undefined,
      },
      ...additional.map((t) => {
        const expired = !!t.valid_until && new Date(t.valid_until) < now;
        const parts: string[] = [];
        if (t.valid_until)
          parts.push(
            `until ${formatInstantDate(t.valid_until, resolveTimeZone(tournament.timezone))}`,
          );
        if (t.age_min != null && t.age_max != null)
          parts.push(`age ${t.age_min}–${t.age_max}`);
        else if (t.age_min != null) parts.push(`age ${t.age_min}+`);
        else if (t.age_max != null) parts.push(`up to age ${t.age_max}`);
        if (t.rating_min != null && t.rating_max != null)
          parts.push(`rating ${t.rating_min}–${t.rating_max}`);
        else if (t.rating_min != null) parts.push(`rating ${t.rating_min}+`);
        else if (t.rating_max != null)
          parts.push(`rating up to ${t.rating_max}`);
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
          rating_min: t.rating_min,
          rating_max: t.rating_max,
        };
      }),
    ];

    return raw
      .map((t) => ({
        ...t,
        // A tier is "eligible" (selectable) unless there's a hard block. A merely
        // missing self-serviceable field keeps it selectable — the prompt collects it.
        eligible:
          !t.expired &&
          checkHardEligibility(
            t,
            restrictions,
            profile,
            startDate,
            ratingContext,
          ) === null,
      }))
      .sort((a, b) => {
        if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
        return a.amount_cents - b.amount_cents;
      });
    // now is stable for the lifetime of this render; profile is the real dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament, restrictions, profile]);

  const [selectedTier, setSelectedTier] = useState<string>(
    () => tiers[0]?.type ?? "standard",
  );
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
    // startDate, not `now` — the same anchor the dropdown's eligible flag uses,
    // so the message can't disagree with which options are selectable.
    return checkHardEligibility(
      selected,
      restrictions,
      profile,
      startDate,
      ratingContext,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, restrictions, profile]);

  // Self-serviceable fields missing for the selected tier — only when there's no
  // hard block (an unfixable error takes precedence over the completion prompt).
  const missingFields = useMemo<CompletableField[]>(() => {
    if (selected.expired || eligibilityError) return [];
    return getMissingProfileFields(selected, tournament, restrictions, profile);
  }, [selected, eligibilityError, tournament, restrictions, profile]);

  // Merge inline-completed fields into local profile state so eligibility and the
  // missing-field list recompute and the normal Confirm & Pay button returns.
  function handleProfileSaved(updated: Partial<PlayerProfile>) {
    setProfile((prev) => ({
      gender: updated.gender ?? prev?.gender ?? null,
      oku_status: prev?.oku_status ?? "none",
      date_of_birth: updated.date_of_birth ?? prev?.date_of_birth ?? null,
      title: prev?.title ?? null,
      fide_rating: prev?.fide_rating ?? null,
      national_rating: prev?.national_rating ?? null,
      fide_id: updated.fide_id ?? prev?.fide_id ?? null,
      mcf_id: updated.mcf_id ?? prev?.mcf_id ?? null,
      nationality: updated.nationality ?? prev?.nationality ?? null,
    }));
  }

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
      // A paid tier returns a CHIP checkout_url; a free (RM0.00) tier is
      // confirmed server-side and returns a redirect_url to the success page.
      const nextUrl = json.data?.checkout_url ?? json.data?.redirect_url;
      if (res.ok && nextUrl) {
        setStatus("redirecting");
        window.location.href = nextUrl;
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

        {/* Error */}
        {status === "error" && errorMessage && (
          <p className="font-lato text-center text-sm text-red-400">
            {errorMessage}
          </p>
        )}

        {/* Inline profile completion, or the submit button once nothing's missing */}
        {missingFields.length > 0 ? (
          <CompleteProfilePrompt
            missing={missingFields}
            onSaved={handleProfileSaved}
          />
        ) : (
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
        )}

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
