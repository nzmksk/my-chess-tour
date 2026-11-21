import { countries } from "country-data-list";

export interface Country {
  alpha2: string;
  alpha3: string;
  name: string;
  emoji?: string;
  countryCallingCodes?: string[];
  currencies?: string[];
  ioc?: string;
  languages?: string[];
  status?: string;
}

const ASSIGNED: Country[] = (countries.all as Country[]).filter(
  (c) => c.status === "assigned" && c.alpha2 && c.name,
);

export function nameToAlpha3(name?: string | null): string | undefined {
  if (!name) return undefined;
  const target = name.trim().toLowerCase();
  return ASSIGNED.find((c) => c.name.toLowerCase() === target)?.alpha3;
}

export function resolveCountry(value?: string | null): Country | undefined {
  if (!value) return undefined;
  const target = value.trim();
  if (!target) return undefined;
  return ASSIGNED.find(
    (c) => c.name === target || c.alpha2 === target || c.alpha3 === target,
  );
}

export function nationalityMatches(
  required: string,
  playerNationality?: string | null,
): boolean {
  const req = resolveCountry(required);
  const player = resolveCountry(playerNationality);
  if (!req || !player) return false;
  return req.alpha3 === player.alpha3;
}
