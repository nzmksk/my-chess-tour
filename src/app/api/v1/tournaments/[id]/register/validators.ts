import { NextResponse } from "next/server";
import type { ChessTitle } from "@/app/tournaments/types";
import type { Restrictions } from "@/app/tournaments/[id]/types";
import { calculateAge } from "@/app/tournaments/utils";

export interface EligibilityProfile {
  date_of_birth: string | null;
  gender: string | null;
  is_oku: boolean;
  title: string | null;
  fide_rating: Record<string, number> | null;
  national_rating: number | null;
}

export interface FeeTier {
  age_min?: number | null;
  age_max?: number | null;
  gender?: string | null;
  oku?: boolean | null;
  titles?: ChessTitle[] | null;
}

export function checkRestrictions(
  restrictions: Restrictions,
  profile: EligibilityProfile | null,
  formatType: string,
  now: Date,
): NextResponse | null {
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
    (!profile?.title ||
      !tier.titles.includes(profile.title as ChessTitle))
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
