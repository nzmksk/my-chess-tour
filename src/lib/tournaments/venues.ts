import { DEFAULT_TIME_ZONE } from "./datetime";

export interface VenueRegion {
  name: string;
  timeZone: string;
}

export interface SupportedCountry {
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
].map((name) => ({ name, timeZone: "Asia/Kuala_Lumpur" }));

export const SUPPORTED_COUNTRIES: readonly SupportedCountry[] = [
  {
    code: "MY",
    name: "Malaysia",
    regions: MALAYSIAN_STATES,
  },
] as const;

export const DEFAULT_COUNTRY_CODE = "MY";

export function findCountry(code: unknown): SupportedCountry | undefined {
  if (typeof code !== "string" || !code) return undefined;
  const upper = code.toUpperCase();
  return SUPPORTED_COUNTRIES.find((c) => c.code === upper);
}

export function isSupportedCountry(code: unknown): boolean {
  return findCountry(code) !== undefined;
}

export function regionsForCountry(code: unknown): readonly VenueRegion[] {
  return findCountry(code)?.regions ?? [];
}

function findRegion(code: unknown, region: unknown): VenueRegion | undefined {
  if (typeof region !== "string" || !region) return undefined;
  return regionsForCountry(code).find((r) => r.name === region);
}

export function isValidRegion(code: unknown, region: unknown): boolean {
  return findRegion(code, region) !== undefined;
}

export function timeZoneForRegion(code: unknown, region: unknown): string {
  return findRegion(code, region)?.timeZone ?? DEFAULT_TIME_ZONE;
}
