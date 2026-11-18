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

interface PrizeFunding {
  source: PrizeFundingSource;
  /** Who is actually putting up the money. Required, and shown publicly. */
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

/**
 * Special prizes qualify a placed result — "Best Female Player" means the best
 * female among the ranked finishers — so they cannot be the only prizes a
 * tournament awards. An organizer who wants to give special prizes must still
 * declare the category they attach to.
 *
 * "Declared" means a category carrying at least one prize entry. A named
 * category with no entries is a structural placeholder (the same reading
 * validatePrizeFunding takes) and does not satisfy the rule.
 */
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

// ── Platform-distributed pools: who is asked for what ──────────────────────
//
// A platform-distributed tournament is not listed until its pool is funded
// (#523). Publishing it moves it to 'pending_funding', and every funder named
// in its prizes is sent a CHIP payment link for their share. The sponsor's
// address is private, so it is NOT in this document (which anyone can read
// once the tournament is listed): it lives in prize_funder_contacts, one row
// per funder name.

/** Where one funder's payment link is sent. */
export interface FunderContact {
  funder_name: string;
  funder_email: string;
}

export const FUNDER_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** How a funder is identified across prizes and contacts: name, ignoring case and outer spaces. */
export function funderKey(name: string): string {
  return name.trim().toLowerCase();
}

export interface DeclaredFunder {
  key: string;
  /** Spelled as it first appears in the prizes. */
  name: string;
  amount_cents: number;
}

/**
 * Each funder's share: what the prizes naming them add up to, in the order
 * they first appear. The twin of declared_prize_funders
 * (007_payment_functions.sql), which decides what each funder is asked for;
 * prizes with no money or no named funder are left out, as there.
 */
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

/**
 * Whether publishing waits for the prize pool: the platform distributes the
 * prizes and there is money to collect. Otherwise a tournament is listed the
 * moment it is published.
 */
export function needsPrizeFunding(prizes: PrizesJson | null | undefined): boolean {
  return prizes?.distribution === "platform" && totalDeclaredPrizeCents(prizes) > 0;
}

/**
 * Funders of a platform-distributed pool with no usable address to send their
 * payment link to, as publish-validation messages. Empty for a tournament the
 * organizer pays out themselves.
 */
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
