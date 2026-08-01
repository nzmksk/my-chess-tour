// Single source of truth for where a tournament can be held: the countries the
// platform accepts as a venue, and the regions (states / provinces) each one has.
//
// Before this module the Malaysian state list was hardcoded in two places — the
// discovery filter bar and the creation wizard — with no country attached, so
// "which states may an organizer pick?" had two answers that could drift apart.
//
// The venue's *timezone* is derived here, from the region rather than the
// country, and written to tournaments.timezone on save. The organizer used to
// pick it from a separate list, which let three fields describing one place
// disagree: a venue could be stated as Singapore, countried as Malaysia and
// clocked in Bangkok, with nothing to reconcile them. A region knows what time
// it is; asking twice only creates a way to get it wrong.
//
// Per-region and not per-country because a country can span several zones —
// Indonesia's WIB/WITA/WIT are the case this shape exists for.
//
// Venue country stays a separate stored column: it decides the payout rails and
// currency a tournament's money moves on, which is a question no timezone can
// answer, and a country's regions can share a zone without sharing a currency.
//
// This is also deliberately NOT src/lib/countries.ts, which wraps
// `country-data-list` for player *nationality*. Venue country and player
// nationality answer different questions and must not be conflated.

import { DEFAULT_TIME_ZONE } from "./datetime";

export interface VenueRegion {
  /** State / province / region, stored in tournaments.venue_state. */
  name: string;
  /** IANA zone the region's calendar dates are read in. */
  timeZone: string;
}

export interface SupportedCountry {
  /** ISO 3166-1 alpha-2, stored in tournaments.venue_country. */
  code: string;
  name: string;
  regions: readonly VenueRegion[];
}

const MALAYSIAN_STATES: readonly VenueRegion[] = [
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
  // Malaysia is one zone throughout, East and West alike, and observes no DST.
].map((name) => ({ name, timeZone: "Asia/Kuala_Lumpur" }));

export const SUPPORTED_COUNTRIES: readonly SupportedCountry[] = [
  {
    code: "MY",
    name: "Malaysia",
    regions: MALAYSIAN_STATES,
  },
] as const;

/** The platform's home country. Matches the tournaments.venue_country default. */
export const DEFAULT_COUNTRY_CODE = "MY";

// These take `unknown` on purpose. Their callers are request handlers holding a
// parsed JSON body, where a field typed `string` in an interface is only a claim
// about what a well-behaved client sends — `{"venue_country": 123}` parses fine
// and would otherwise reach `.toUpperCase()` and throw. Validating the type here
// rather than at each call site means a caller cannot forget, and none of them
// need a cast to compile.

/** The supported country `code` names, or undefined for anything else. */
export function findCountry(code: unknown): SupportedCountry | undefined {
  if (typeof code !== "string" || !code) return undefined;
  const upper = code.toUpperCase();
  return SUPPORTED_COUNTRIES.find((c) => c.code === upper);
}

export function isSupportedCountry(code: unknown): boolean {
  return findCountry(code) !== undefined;
}

/** Regions for a country; empty when the code is unknown. */
export function regionsForCountry(code: unknown): readonly VenueRegion[] {
  return findCountry(code)?.regions ?? [];
}

function findRegion(code: unknown, region: unknown): VenueRegion | undefined {
  if (typeof region !== "string" || !region) return undefined;
  return regionsForCountry(code).find((r) => r.name === region);
}

/** True when `region` is a known region of `code`. Used by write-path validation. */
export function isValidRegion(code: unknown, region: unknown): boolean {
  return findRegion(code, region) !== undefined;
}

/**
 * The timezone a venue's dates are read in, derived from where it is.
 *
 * Falls back to the platform default for an unknown country or region rather
 * than throwing: callers write the result straight to `tournaments.timezone`,
 * and a zone `Intl` cannot parse takes down every page that formats a date.
 * Write paths validate the region separately (isValidRegion), so the fallback
 * is a safety net, not the way a bad region gets accepted.
 */
export function timeZoneForRegion(code: unknown, region: unknown): string {
  return findRegion(code, region)?.timeZone ?? DEFAULT_TIME_ZONE;
}
