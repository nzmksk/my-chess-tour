// Single source of truth for where a tournament can be held: the countries the
// platform accepts as a venue, and the regions (states / provinces) each one has.
//
// Before this module the Malaysian state list was hardcoded in two places — the
// discovery filter bar and the creation wizard — with no country attached, so
// "which states may an organizer pick?" had two answers that could drift apart.
//
// The venue's *timezone* is deliberately NOT here. It is a separate stored
// column that the organizer picks (see VENUE_TIME_ZONES in src/lib/datetime.ts),
// because the country a venue sits in and the clock its dates are read in are
// independent choices — a country can span several zones, and picking the zone
// directly is what an organizer can actually verify.
//
// Venue country exists for the payout work: it decides the rails and currency a
// tournament's money moves on, which is a question no timezone can answer.
//
// This is also deliberately NOT src/lib/countries.ts, which wraps
// `country-data-list` for player *nationality*. Venue country and player
// nationality answer different questions and must not be conflated.

export interface SupportedCountry {
  /** ISO 3166-1 alpha-2, stored in tournaments.venue_country. */
  code: string;
  name: string;
  /** States / provinces / regions, stored in tournaments.venue_state. */
  regions: readonly string[];
}

const MALAYSIAN_STATES = [
  "Johor",
  "Kedah",
  "Kelantan",
  "Melaka",
  "Negeri Sembilan",
  "Pahang",
  "Perak",
  "Perlis",
  "Pulau Pinang",
  "Sabah",
  "Sarawak",
  "Selangor",
  "Terengganu",
  "W.P. Kuala Lumpur",
  "W.P. Labuan",
  "W.P. Putrajaya",
] as const;

export const SUPPORTED_COUNTRIES: readonly SupportedCountry[] = [
  {
    code: "MY",
    name: "Malaysia",
    regions: MALAYSIAN_STATES,
  },
] as const;

/** The platform's home country. Matches the tournaments.venue_country default. */
export const DEFAULT_COUNTRY_CODE = "MY";

export function findCountry(code: string | null | undefined) {
  if (!code) return undefined;
  const upper = code.toUpperCase();
  return SUPPORTED_COUNTRIES.find((c) => c.code === upper);
}

export function isSupportedCountry(code: string | null | undefined): boolean {
  return findCountry(code) !== undefined;
}

/** Regions for a country; empty when the code is unknown. */
export function regionsForCountry(
  code: string | null | undefined,
): readonly string[] {
  return findCountry(code)?.regions ?? [];
}

/** True when `region` is a known region of `code`. Used by write-path validation. */
export function isValidRegion(
  code: string | null | undefined,
  region: string | null | undefined,
): boolean {
  if (!region) return false;
  return regionsForCountry(code).includes(region);
}
