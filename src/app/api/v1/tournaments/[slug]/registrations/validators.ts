import { NextResponse } from "next/server";
import type { ChessTitle } from "@/app/tournaments/types";
import type { Restrictions } from "@/app/tournaments/[slug]/types";
import { calculateAge } from "@/app/tournaments/utils";
import { nationalityMatches, resolveCountry } from "@/lib/countries";

export interface EligibilityProfile {
  date_of_birth: string | null;
  gender: string | null;
  is_oku: boolean;
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

export function normalizeRestrictions(raw: unknown): Restrictions | null {
  if (!raw) return null;
  if (!Array.isArray(raw)) return raw as Restrictions;

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
  return Object.keys(result).length > 0 ? result : null;
}

export function checkRestrictions(
  restrictions: Restrictions,
  profile: EligibilityProfile | null,
  formatType: string,
  now: Date,
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
    const ratingKey =
      formatType === "blitz"
        ? "blitz"
        : formatType === "rapid"
          ? "rapid"
          : "standard";
    const playerRating =
      profile?.fide_rating?.[ratingKey] ?? profile?.national_rating ?? null;

    if (
      restrictions.min_rating != null &&
      (playerRating == null || playerRating < restrictions.min_rating)
    ) {
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

    if (
      restrictions.max_rating != null &&
      playerRating != null &&
      playerRating > restrictions.max_rating
    ) {
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

    const age = calculateAge(new Date(profile.date_of_birth), now);

    if (restrictions.min_age != null && age < restrictions.min_age) {
      return NextResponse.json(
        {
          error: {
            code: "ELIGIBILITY_ERROR",
            message: `You must be at least ${restrictions.min_age} years old to enter`,
          },
        },
        { status: 422 },
      );
    }

    if (restrictions.max_age != null && age > restrictions.max_age) {
      return NextResponse.json(
        {
          error: {
            code: "ELIGIBILITY_ERROR",
            message: `You must be ${restrictions.max_age} years old or younger to enter`,
          },
        },
        { status: 422 },
      );
    }
  }

  return null;
}

export function checkFeeTierEligibility(
  tier: FeeTier,
  profile: EligibilityProfile | null,
  now: Date,
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

  if (tier.oku && !profile?.is_oku) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_FEE_TIER",
          message: "This fee tier is for OKU players only",
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

    const age = calculateAge(new Date(profile.date_of_birth), now);

    if (tier.age_min != null && age < tier.age_min) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_FEE_TIER",
            message: `You must be at least ${tier.age_min} years old for this tier`,
          },
        },
        { status: 400 },
      );
    }

    if (tier.age_max != null && age > tier.age_max) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_FEE_TIER",
            message: `You must be ${tier.age_max} years old or younger for this tier`,
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
