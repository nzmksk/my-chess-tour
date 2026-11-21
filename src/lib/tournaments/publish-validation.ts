import {
  validateFunderContacts,
  validatePrizeFunding,
  validatePrizeStructure,
  type FunderContact,
  type PrizesJson,
} from "@/lib/tournaments/prize-funding";

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
  today: string;
  now: string;
  requireFutureStartDate?: boolean;
  requireFutureDeadline?: boolean;
  funderContacts?: readonly FunderContact[];
}

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

  errors.push(...validatePrizeFunding(t.prizes));
  errors.push(...validatePrizeStructure(t.prizes));
  if (funderContacts) {
    errors.push(...validateFunderContacts(t.prizes, funderContacts));
  }

  return errors;
}
