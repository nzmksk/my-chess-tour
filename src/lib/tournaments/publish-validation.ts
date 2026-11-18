// What a tournament must have before it can be listed publicly.
//
// The publish route checks a draft against this before it goes live, and the
// PATCH route checks a published tournament against it after every edit: a
// listing players can already see has to stay one that could have been
// published. Without the second check an organizer could publish a complete
// tournament and then blank its venue or move its start date into the past.

import {
  validateFunderContacts,
  validatePrizeFunding,
  validatePrizeStructure,
  type FunderContact,
  type PrizesJson,
} from "@/lib/tournaments/prize-funding";

/**
 * What a draft saved without dates holds instead. The columns are NOT NULL, so
 * the create route writes these; publish treats them as missing.
 */
export const PLACEHOLDER_DATE = "2099-12-31";
export const PLACEHOLDER_DEADLINE = "2099-12-30T23:59:59Z";

export interface PublishableTournament {
  name: string | null;
  venue_name: string | null;
  venue_state: string | null;
  venue_address: string | null;
  start_date: string | null;
  end_date: string | null;
  registration_deadline: string | null;
  format: { type?: string; system?: string; rounds?: number } | null;
  time_control: { base_minutes?: number } | null;
  entry_fees: { standard?: { amount_cents?: number } } | null;
  prizes: PrizesJson | null;
}

interface PublishValidationOptions {
  /** Today's calendar date at the venue — see getTodayInTimeZone. */
  today: string;
  /** The current instant, as an ISO string. */
  now: string;
  /**
   * Whether to require the start date and registration deadline to be in the
   * future. Publishing always does. An edit to a published tournament only
   * does for a date it is changing: a deadline that has already passed is a
   * closed registration, and resending it unchanged with a new description is
   * not moving it into the past.
   */
  requireFutureStartDate?: boolean;
  requireFutureDeadline?: boolean;
  /**
   * The tournament's funder contacts (prize_funder_contacts). When given, a
   * platform-distributed tournament also needs an address for every funder,
   * because publishing sends each of them a payment link. Omitted, the check
   * is skipped.
   */
  funderContacts?: readonly FunderContact[];
}

/** Every reason `t` can't be published, or an empty array when it can. */
export function validatePublishable(
  t: PublishableTournament,
  {
    today,
    now,
    requireFutureStartDate = true,
    requireFutureDeadline = true,
    funderContacts,
  }: PublishValidationOptions,
): string[] {
  const errors: string[] = [];

  if (!t.name?.trim()) {
    errors.push("Tournament name is required");
  }
  if (!t.venue_name?.trim()) {
    errors.push("Venue name is required");
  }
  if (!t.venue_state?.trim()) {
    errors.push("Venue state is required");
  }
  if (!t.venue_address?.trim()) {
    errors.push("Venue address is required");
  }

  // A start date is a calendar date at the venue, so "still in the future" is
  // judged against the venue's today rather than the server's.
  if (
    !t.start_date ||
    t.start_date === PLACEHOLDER_DATE ||
    (requireFutureStartDate && t.start_date <= today)
  ) {
    errors.push("Start date must be a future date");
  }
  if (!t.end_date || t.end_date === PLACEHOLDER_DATE) {
    errors.push("End date is required");
  }
  if (
    !t.registration_deadline ||
    t.registration_deadline === PLACEHOLDER_DEADLINE ||
    (requireFutureDeadline &&
      new Date(t.registration_deadline).getTime() <= new Date(now).getTime())
  ) {
    errors.push("Registration deadline must be a future date");
  }

  const fmt = t.format;
  if (!fmt?.type?.trim()) {
    errors.push("Tournament format type is required");
  }
  if (!fmt?.system?.trim()) {
    errors.push("Tournament system is required");
  }
  if (!fmt?.rounds || fmt.rounds < 1) {
    errors.push("Number of rounds must be at least 1");
  }

  const tc = t.time_control;
  if (!tc?.base_minutes || tc.base_minutes < 1) {
    errors.push("Time control base time is required");
  }

  if (!t.entry_fees?.standard) {
    errors.push("Standard entry fee is required");
  }

  // Entry fees are an administration fee and never fund prizes, so any prize
  // with money attached has to name where that money actually comes from. See
  // src/lib/tournaments/prize-funding.ts for the reasoning.
  errors.push(...validatePrizeFunding(t.prizes));
  // Special prizes attach to a placed result, so they cannot stand alone.
  errors.push(...validatePrizeStructure(t.prizes));
  // A platform-distributed pool is collected from its funders, by email.
  if (funderContacts) {
    errors.push(...validateFunderContacts(t.prizes, funderContacts));
  }

  return errors;
}
