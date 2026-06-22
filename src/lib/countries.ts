import { countries } from "country-data-list";
import type { Country } from "@/components/ui/country-dropdown";

const ASSIGNED: Country[] = (countries.all as Country[]).filter(
  (c) => c.status === "assigned" && c.alpha2 && c.name,
);

/**
 * Resolve a stored country name (e.g. "Malaysia") to its ISO 3166-1 alpha-3
 * code (e.g. "MYS"), which the CountryDropdown uses as its defaultValue.
 * Returns undefined for empty/unknown values (e.g. legacy free-text demonyms).
 */
export function nameToAlpha3(name?: string | null): string | undefined {
  if (!name) return undefined;
  const target = name.trim().toLowerCase();
  return ASSIGNED.find((c) => c.name.toLowerCase() === target)?.alpha3;
}

/**
 * Resolve a stored country value to its canonical country record. Matches by
 * full name (e.g. "Malaysia"), alpha-2 (e.g. "MY"), or alpha-3 (e.g. "MYS"),
 * case-insensitively. Returns undefined for empty/unknown values (e.g. legacy
 * free-text demonyms) so callers can fall back to text.
 */
export function resolveCountry(value?: string | null): Country | undefined {
  if (!value) return undefined;
  const target = value.trim();
  if (!target) return undefined;
  return ASSIGNED.find(
    (c) => c.name === target || c.alpha2 === target || c.alpha3 === target,
  );
}

/**
 * Resolve a stored country name (e.g. "Malaysia") to its ISO 3166-1 alpha-2
 * code (e.g. "MY"), used to render a flag. Returns undefined for empty/unknown
 * values (e.g. legacy free-text demonyms) so callers can fall back to text.
 */
export function nameToAlpha2(name?: string | null): string | undefined {
  return resolveCountry(name)?.alpha2;
}
