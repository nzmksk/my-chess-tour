// The shapes the create/edit wizard works with: the state it holds (one per
// step, plus the snapshot persisted to sessionStorage between steps) and the
// canonical JSON those states are translated to and from on the way to the API.
//
// These live outside TournamentWizardContext so the modules that translate
// between wizard state and the API — entryFees.ts, restrictions.ts — and the
// server component that seeds an edit session can reference them without
// importing a "use client" module.

// =============================================
// WIZARD STATE
// =============================================

export type WizardStepId =
  | "basic-info"
  | "format"
  | "fees"
  | "prizes"
  | "review";

export interface WizardStep {
  id: WizardStepId;
  label: string;
}

export interface BasicInfoData {
  name: string;
  description: string;
  venueName: string;
  /**
   * ISO 3166-1 alpha-2 of the venue's country. Decides which regions the state
   * dropdown offers, and which payout rails the tournament's money will move
   * on. Independent of `timezone` — a country can span several zones.
   */
  venueCountry: string;
  venueState: string;
  venueAddress: string;
  /**
   * IANA timezone of the venue. Every date and time in the wizard is entered in
   * this zone — it is what the organizer means by "6pm" — and it is what the
   * tournament is later displayed and bucketed in.
   */
  timezone: string;
}

/**
 * What a single restriction row constrains. One kind per row, so the two ends
 * of a rating range are two rows — which is why this is finer-grained than the
 * stored PersistedRestriction, whose "rating" item can carry both a min and a
 * max. See RESTRICTION_LABELS in restrictions.ts for the UI copy.
 */
export type RestrictionKind =
  | "max_age"
  | "min_rating"
  | "max_rating"
  | "gender"
  | "nationality";

/**
 * One eligibility restriction row. Rows carry an id because, unlike fee tiers,
 * the same kind may legitimately appear more than once while being edited.
 * `value` is the raw field text for every kind — a rating, a gender, or a
 * country name — and is normalized on the way out by restrictions.ts.
 */
export interface Restriction {
  id: string;
  kind: RestrictionKind;
  value: string;
}

export interface FormatData {
  formatType: string;
  system: string;
  rounds: number | "";
  baseTime: number | "";
  increment: number | "";
  delay: number | "";
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  maxParticipants: number | "";
  fideRated: boolean;
  mcfRated: boolean;
  restrictions: Restriction[];
}

/**
 * Tier discriminator, shared by the wizard and the stored JSON. These strings
 * are also what `registrations.fee_tier` records and what checkout matches a
 * registration against, so they are not a display concern — see TIER_LABELS in
 * entryFees.ts for the UI copy.
 */
export type TierType =
  | "early_bird"
  | "titled_players"
  | "rating_based"
  | "age_based";

/**
 * A fee tier as the wizard edits it. No row id: the tier type is unique within
 * a tournament (FeesStep only offers types not already present), so it is the
 * row key. Amounts are in ringgit and bounds may be "" while a field is
 * cleared — see entryFees.ts for the conversion to the stored shape.
 */
export interface FeeTier {
  type: TierType;
  amount: number | "";
  validUntil: string;
  titles: string[];
  ratingFrom: number | "";
  ratingTo: number | "";
  ageFrom: number | "";
  ageTo: number | "";
}

export interface FeesData {
  standardFee: number | "";
  tiers: FeeTier[];
}

export interface PrizeRow {
  id: string;
  placement: string;
  amount: number | "";
}

export interface PrizeCategory {
  id: string;
  name: string;
  prizes: PrizeRow[];
}

export interface SpecialPrize {
  id: string;
  name: string;
  amount: number | "";
}

export interface PrizesData {
  categories: PrizeCategory[];
  specialPrizes: SpecialPrize[];
}

export interface PersistedState {
  basicInfoData: BasicInfoData;
  formatData: FormatData;
  feesData: FeesData;
  prizesData: PrizesData;
  tournamentId: string | null;
  currentStepIndex: number;
  completedSteps: number[];
}

// =============================================
// RESTRICTIONS — normalized `tournaments.restrictions` JSON
// See restrictions.ts for the mapping to and from Restriction rows.
// =============================================

/**
 * The normalized shape consumed by normalizeRestrictions / checkRestrictions at
 * registration time. Persisting this rather than the UI labels is what makes
 * wizard-created restrictions actually enforce.
 */
export type PersistedRestriction =
  | { type: "age"; min?: number | null; max?: number | null }
  | { type: "rating"; min?: number | null; max?: number | null }
  | { type: "gender"; value: string }
  | { type: "nationality"; value: string };

// =============================================
// ENTRY FEES — canonical `tournaments.entry_fees` JSON
// See entryFees.ts for the mapping to and from FeesData.
// =============================================

/** A tier as the wizard writes it. */
export interface PersistedFeeTier {
  type: TierType;
  amount_cents: number;
  valid_until?: string;
  titles?: string[];
  rating_min?: number;
  rating_max?: number;
  age_min?: number;
  age_max?: number;
}

export interface PersistedEntryFees {
  standard: { amount_cents: number };
  additional: PersistedFeeTier[];
}

/**
 * A tier as it comes back out of the jsonb column: `type` widened because tiers
 * the wizard cannot express (gender/oku) are part of the canonical model, and
 * every field nullable because nothing constrains the column's contents.
 */
export interface StoredFeeTier {
  type: string;
  amount_cents?: number;
  valid_until?: string | null;
  titles?: string[] | null;
  rating_min?: number | null;
  rating_max?: number | null;
  age_min?: number | null;
  age_max?: number | null;
}

export interface StoredEntryFees {
  standard?: { amount_cents?: number } | null;
  additional?: StoredFeeTier[] | null;
}
