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
