import { NextResponse } from "next/server";
import type { ChessTitle } from "@/app/tournaments/types";
import type { Restrictions } from "@/app/tournaments/[slug]/types";
import type { OkuStatus } from "@/app/profile/types";
import {
  checkAgeEligibility,
  checkRatingEligibility,
  describeRatingList,
  resolvePlayerRating,
} from "@/app/tournaments/utils";
import type { RatingContext } from "@/app/tournaments/utils";
import { nationalityMatches, resolveCountry } from "@/lib/countries";

export interface EligibilityProfile {
  date_of_birth: string | null;
  gender: string | null;
  oku_status: OkuStatus;
  title: string | null;
  fide_rating: Record<string, number> | null;
  national_rating: number | null;
  fide_id: number | null;
  mcf_id: number | null;
  nationality: string | null;
}

export interface FeeTier {
  age_min?: number | null;
  age_max?: number | null;
  rating_min?: number | null;
  rating_max?: number | null;
  gender?: string | null;
  oku?: boolean | null;
  titles?: ChessTitle[] | null;
}

type RawRestrictionItem = {
  type: string;
  min?: number;
  max?: number;
  value?: string;
};

function hasAnyRestriction(r: Restrictions): boolean {
  return (
    r.min_rating != null ||
    r.max_rating != null ||
    r.min_age != null ||
    r.max_age != null ||
    !!r.gender ||
    !!r.nationality
  );
}

export function normalizeRestrictions(raw: unknown): Restrictions | null {
  if (!raw) return null;
  if (!Array.isArray(raw)) {
    const obj = raw as Restrictions;
    return hasAnyRestriction(obj) ? obj : null;
  }

  const result: Restrictions = {};
  for (const item of raw as RawRestrictionItem[]) {
    switch (item.type) {
      case "rating":
        if (item.min != null) result.min_rating = item.min;
        if (item.max != null) result.max_rating = item.max;
        break;
      case "age":
        if (item.min != null) result.min_age = item.min;
        if (item.max != null) result.max_age = item.max;
        break;
      case "gender":
        if (item.value != null) result.gender = item.value;
        break;
      case "nationality":
        if (item.value != null) result.nationality = item.value;
        break;
    }
  }
  return hasAnyRestriction(result) ? result : null;
}

export function checkRestrictions(
  restrictions: Restrictions,
  profile: EligibilityProfile | null,
  rating: RatingContext,
  startDate: Date,
): NextResponse | null {
  if (restrictions.gender != null && profile?.gender !== restrictions.gender) {
    return NextResponse.json(
      {
        error: {
          code: "ELIGIBILITY_ERROR",
          message: `This tournament is for ${restrictions.gender} players only`,
        },
      },
      { status: 422 },
    );
  }

  if (restrictions.nationality != null) {
    // A missing nationality is self-serviceable (fixed via the inline prompt),
    // so it's a fixable VALIDATION_ERROR; a mismatch is a hard ELIGIBILITY_ERROR.
    if (profile?.nationality == null) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message:
              "Your profile is missing a nationality required for this tournament",
          },
        },
        { status: 422 },
      );
    }
    if (!nationalityMatches(restrictions.nationality, profile.nationality)) {
      const label =
        resolveCountry(restrictions.nationality)?.name ??
        restrictions.nationality;
      return NextResponse.json(
        {
          error: {
            code: "ELIGIBILITY_ERROR",
            message: `This tournament is for ${label} players only`,
          },
        },
        { status: 422 },
      );
    }
  }

  if ((restrictions.titles?.length ?? 0) > 0) {
    if (
      !profile?.title ||
      !restrictions.titles!.includes(profile.title as ChessTitle)
    ) {
      return NextResponse.json(
        {
          error: {
            code: "ELIGIBILITY_ERROR",
            message: `This tournament is for titled players only (${restrictions.titles!.join(", ")})`,
          },
        },
        { status: 422 },
      );
    }
  }

  if (restrictions.min_rating != null || restrictions.max_rating != null) {
    const ratingResult = checkRatingEligibility(
      resolvePlayerRating(profile, rating),
      restrictions.min_rating ?? null,
      restrictions.max_rating ?? null,
    );

    if (ratingResult === "below_min") {
      return NextResponse.json(
        {
          error: {
            code: "ELIGIBILITY_ERROR",
            message: `A minimum rating of ${restrictions.min_rating} is required`,
          },
        },
        { status: 422 },
      );
    }

    if (ratingResult === "above_max") {
      return NextResponse.json(
        {
          error: {
            code: "ELIGIBILITY_ERROR",
            message: `Your rating exceeds the maximum allowed (${restrictions.max_rating})`,
          },
        },
        { status: 422 },
      );
    }
  }

  if (restrictions.min_age != null || restrictions.max_age != null) {
    if (!profile?.date_of_birth) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message:
              "Your player profile is missing a date of birth required for this tournament",
          },
        },
        { status: 422 },
      );
    }

    const ageResult = checkAgeEligibility(
      new Date(profile.date_of_birth),
      startDate,
      restrictions.min_age ?? null,
      restrictions.max_age ?? null,
    );

    if (ageResult === "too_young") {
      return NextResponse.json(
        {
          error: {
            code: "ELIGIBILITY_ERROR",
            message: `You must be at least ${restrictions.min_age} years old on the tournament start date to enter`,
          },
        },
        { status: 422 },
      );
    }

    if (ageResult === "too_old") {
      return NextResponse.json(
        {
          error: {
            code: "ELIGIBILITY_ERROR",
            message: `You must not turn ${restrictions.max_age} before the tournament start date to enter`,
          },
        },
        { status: 422 },
      );
    }
  }

  return null;
}

/**
 * Whether the player may claim `tier`'s price. `rating` names the list a
 * rating-based tier is judged against — the tournament's format plus which
 * federation rates it (see resolvePlayerRating), the same way checkRestrictions
 * does.
 */
export function checkFeeTierEligibility(
  tier: FeeTier,
  profile: EligibilityProfile | null,
  startDate: Date,
  rating: RatingContext,
): NextResponse | null {
  if (tier.gender === "female" && profile?.gender !== "female") {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_FEE_TIER",
          message: "This fee tier is for female players only",
        },
      },
      { status: 400 },
    );
  }

  if (tier.oku && profile?.oku_status !== "verified") {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_FEE_TIER",
          message: "This fee tier is for verified OKU players only",
        },
      },
      { status: 400 },
    );
  }

  if (
    tier.titles?.length &&
    (!profile?.title || !tier.titles.includes(profile.title as ChessTitle))
  ) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_FEE_TIER",
          message: `This fee tier is for titled players only (${tier.titles.join(", ")})`,
        },
      },
      { status: 400 },
    );
  }

  if (tier.rating_min != null || tier.rating_max != null) {
    const playerRating = resolvePlayerRating(profile, rating);
    const ratingResult = checkRatingEligibility(
      playerRating,
      tier.rating_min ?? null,
      tier.rating_max ?? null,
    );

    // A rating isn't self-serviceable (FIDE ratings are synced, national ones
    // come from the federation), so a missing one is a hard block for a tier
    // with a floor rather than a fixable VALIDATION_ERROR.
    if (ratingResult === "below_min") {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_FEE_TIER",
            message:
              playerRating == null
                ? `This fee tier requires a rating of at least ${tier.rating_min}, and your profile has no ${describeRatingList(rating)} rating`
                : `This fee tier requires a minimum rating of ${tier.rating_min}`,
          },
        },
        { status: 400 },
      );
    }

    if (ratingResult === "above_max") {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_FEE_TIER",
            message: `Your rating exceeds this fee tier's maximum (${tier.rating_max})`,
          },
        },
        { status: 400 },
      );
    }
  }

  if (tier.age_min != null || tier.age_max != null) {
    if (!profile?.date_of_birth) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message:
              "Your player profile is missing a date of birth required for this fee tier",
          },
        },
        { status: 422 },
      );
    }

    const ageResult = checkAgeEligibility(
      new Date(profile.date_of_birth),
      startDate,
      tier.age_min ?? null,
      tier.age_max ?? null,
    );

    if (ageResult === "too_young") {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_FEE_TIER",
            message: `You must be at least ${tier.age_min} years old on the tournament start date for this tier`,
          },
        },
        { status: 400 },
      );
    }

    if (ageResult === "too_old") {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_FEE_TIER",
            message: `You must not turn ${tier.age_max} before the tournament start date for this tier`,
          },
        },
        { status: 400 },
      );
    }
  }

  return null;
}

/**
 * A FIDE-rated tournament requires the player to have a FIDE ID, and an MCF-rated
 * tournament requires an MCF ID, so the result can be submitted to the federation
 * for rating. Both IDs are self-serviceable (set once in the profile), so a missing
 * one is a fixable VALIDATION_ERROR rather than a hard ELIGIBILITY_ERROR.
 */
export function checkRatedRequirements(
  flags: { is_fide_rated: boolean; is_mcf_rated: boolean },
  profile: EligibilityProfile | null,
): NextResponse | null {
  if (flags.is_fide_rated && profile?.fide_id == null) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message:
            "Your profile is missing a FIDE ID required for this FIDE-rated tournament",
        },
      },
      { status: 422 },
    );
  }

  if (flags.is_mcf_rated && profile?.mcf_id == null) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message:
            "Your profile is missing an MCF ID required for this MCF-rated tournament",
        },
      },
      { status: 422 },
    );
  }

  return null;
}
