export const PRIZE_FUNDING_SOURCES = ["sponsor", "grant", "organizer"] as const;
export type PrizeFundingSource = (typeof PRIZE_FUNDING_SOURCES)[number];

export const PRIZE_FUNDING_LABELS: Record<PrizeFundingSource, string> = {
  sponsor: "Sponsor",
  grant: "Grant / government funding",
  organizer: "Organizer's own funds",
};

export const PRIZE_DISTRIBUTION_MODES = ["organizer", "platform"] as const;
export type PrizeDistribution = (typeof PRIZE_DISTRIBUTION_MODES)[number];

interface PrizeFunding {
  source: PrizeFundingSource;
  funder_name: string;
}

interface PrizeEntry {
  place?: string;
  amount_cents?: number;
}

interface PrizeCategoryJson {
  name?: string;
  funding?: PrizeFunding | null;
  entries?: PrizeEntry[];
}

interface SpecialPrizeJson {
  name?: string;
  funding?: PrizeFunding | null;
  amount_cents?: number;
}

export interface PrizesJson {
  categories?: PrizeCategoryJson[];
  special?: SpecialPrizeJson[];
  distribution?: PrizeDistribution;
}

export function isPrizeFundingSource(v: unknown): v is PrizeFundingSource {
  return (
    typeof v === "string" &&
    (PRIZE_FUNDING_SOURCES as readonly string[]).includes(v)
  );
}

export function isPrizeDistribution(v: unknown): v is PrizeDistribution {
  return (
    typeof v === "string" &&
    (PRIZE_DISTRIBUTION_MODES as readonly string[]).includes(v)
  );
}

function categoryTotal(cat: PrizeCategoryJson): number {
  return (cat.entries ?? []).reduce(
    (sum, e) => sum + (typeof e.amount_cents === "number" ? e.amount_cents : 0),
    0,
  );
}

export function totalDeclaredPrizeCents(
  prizes: PrizesJson | null | undefined,
): number {
  if (!prizes) return 0;
  const cats = (prizes.categories ?? []).reduce(
    (sum, c) => sum + categoryTotal(c),
    0,
  );
  const special = (prizes.special ?? []).reduce(
    (sum, s) => sum + (typeof s.amount_cents === "number" ? s.amount_cents : 0),
    0,
  );
  return cats + special;
}

export function validatePrizeStructure(
  prizes: PrizesJson | null | undefined,
): string[] {
  if (!prizes) return [];
  if ((prizes.special ?? []).length === 0) return [];

  const hasFilledCategory = (prizes.categories ?? []).some(
    (cat) => (cat.entries ?? []).length > 0,
  );
  if (hasFilledCategory) return [];

  return [
    "Add at least one prize category with a placing — special prizes cannot be the only prizes a tournament awards",
  ];
}

function fundingErrorsFor(
  label: string,
  funding: PrizeFunding | null | undefined,
): string[] {
  if (!funding || !isPrizeFundingSource(funding.source)) {
    return [`${label}: choose where the prize money comes from`];
  }
  if (!funding.funder_name?.trim()) {
    return [`${label}: name the sponsor or funder`];
  }
  return [];
}

export function validatePrizeFunding(
  prizes: PrizesJson | null | undefined,
): string[] {
  if (!prizes) return [];

  const errors: string[] = [];

  for (const cat of prizes.categories ?? []) {
    if (categoryTotal(cat) <= 0) continue;
    errors.push(
      ...fundingErrorsFor(cat.name?.trim() || "Prize category", cat.funding),
    );
  }

  for (const sp of prizes.special ?? []) {
    if (!sp.amount_cents || sp.amount_cents <= 0) continue;
    errors.push(
      ...fundingErrorsFor(sp.name?.trim() || "Special prize", sp.funding),
    );
  }

  if (
    prizes.distribution !== undefined &&
    !isPrizeDistribution(prizes.distribution)
  ) {
    errors.push("Prize distribution must be either organizer or platform");
  }

  return errors;
}

export interface FunderContact {
  funder_name: string;
  funder_email: string;
}

export const FUNDER_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function funderKey(name: string): string {
  return name.trim().toLowerCase();
}

export interface DeclaredFunder {
  key: string;
  name: string;
  amount_cents: number;
}

export function declaredFunders(
  prizes: PrizesJson | null | undefined,
): DeclaredFunder[] {
  if (!prizes) return [];
  const byKey = new Map<string, DeclaredFunder>();
  const add = (funding: PrizeFunding | null | undefined, cents: number) => {
    const name = funding?.funder_name?.trim();
    if (!name || cents <= 0) return;
    const key = funderKey(name);
    const found = byKey.get(key);
    if (found) found.amount_cents += cents;
    else byKey.set(key, { key, name, amount_cents: cents });
  };
  for (const cat of prizes.categories ?? []) add(cat.funding, categoryTotal(cat));
  for (const sp of prizes.special ?? []) {
    add(sp.funding, typeof sp.amount_cents === "number" ? sp.amount_cents : 0);
  }
  return [...byKey.values()].filter((f) => f.amount_cents > 0);
}

export function needsPrizeFunding(prizes: PrizesJson | null | undefined): boolean {
  return prizes?.distribution === "platform" && totalDeclaredPrizeCents(prizes) > 0;
}

export function validateFunderContacts(
  prizes: PrizesJson | null | undefined,
  contacts: readonly FunderContact[],
): string[] {
  if (prizes?.distribution !== "platform") return [];
  const emails = new Map(
    contacts.map((c) => [funderKey(c.funder_name), c.funder_email.trim()]),
  );
  return declaredFunders(prizes)
    .filter((f) => !FUNDER_EMAIL_RE.test(emails.get(f.key) ?? ""))
    .map((f) => `${f.name}: add the email address their payment link is sent to`);
}
