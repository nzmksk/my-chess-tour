// Where a tournament's prize money comes from, and who distributes it.
//
// THE RULE: entry fees never fund prizes.
//
// Entry fees are an administration fee — venue, arbiters, equipment, rating
// fees — an ordinary commercial exchange for organizing a competition. Prizes
// must come from somewhere else: a sponsor, a grant, or the organizer's own
// funds. A pool that every competitor pays into and the winners take out is a
// different kind of arrangement entirely, and the platform does not host it.
//
// Publish validation enforces this: a tournament that declares prize money
// without naming an external source for it cannot go live. There is
// deliberately no "entry_fees" member of PrizeFundingSource — the rule is
// expressed in the type, not just in a check.
//
// Consequence for payouts: because entry-fee revenue never owes anything to a
// prize pool, an organizer's payout is their net revenue in full, with no prize
// holdback. Prize money the platform holds (distribution === "platform") is
// ring-fenced in its own balance and never mixed into organizer revenue.

export const PRIZE_FUNDING_SOURCES = ["sponsor", "grant", "organizer"] as const;
export type PrizeFundingSource = (typeof PRIZE_FUNDING_SOURCES)[number];

export const PRIZE_FUNDING_LABELS: Record<PrizeFundingSource, string> = {
  sponsor: "Sponsor",
  grant: "Grant / government funding",
  organizer: "Organizer's own funds",
};

/**
 * Who hands the money to the winners.
 * - "organizer" (default): the organizer pays winners directly, off-platform.
 * - "platform": the organizer appoints us to distribute. The pool must be paid
 *   in and fully funded before any winner is paid.
 */
export const PRIZE_DISTRIBUTION_MODES = ["organizer", "platform"] as const;
export type PrizeDistribution = (typeof PRIZE_DISTRIBUTION_MODES)[number];

export interface PrizeFunding {
  source: PrizeFundingSource;
  /** Who is actually putting up the money. Required, and shown publicly. */
  funder_name: string;
}

export interface PrizeEntry {
  place?: string;
  amount_cents?: number;
}

export interface PrizeCategoryJson {
  name?: string;
  funding?: PrizeFunding | null;
  entries?: PrizeEntry[];
}

export interface SpecialPrizeJson {
  name?: string;
  funding?: PrizeFunding | null;
  amount_cents?: number;
}

/** The shape stored in `tournaments.prizes`. */
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

/** Total declared prize money across categories and special prizes, in cents. */
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

/**
 * Validates the prize-funding declaration for publish.
 *
 * Only prizes with money attached need a source — an empty category is a
 * structural placeholder, not a promise to pay anyone. Returns human-readable
 * messages in the same style as the rest of the publish validation, so they can
 * be appended straight onto its `validationErrors` array.
 */
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
