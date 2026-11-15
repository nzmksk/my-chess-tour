// Which tournament fields an organizer can still change, and when each one
// stops being editable.
//
// A tournament moves through stages, and each stage locks more of it:
//
//   draft      Everything is editable. Nobody can see it, nobody has paid.
//   published  Everything is still editable, but the listing has to stay
//              publishable: required fields can't be blanked and dates can't
//              move into the past. Players can see it, but nobody has paid,
//              so there's no deal to protect yet.
//   paid       The first registration payment has settled. What the player
//              paid for locks: the price, the prizes, the capacity, who gets
//              the money, when and where (country/state) it runs, what kind of
//              event it is, and who's eligible. Cosmetic details (name,
//              description, venue name and address) and the registration
//              deadline stay editable.
//   ongoing    The start date has arrived. Only the description is editable,
//              so the organizer can still post notices (pairings links, venue
//              changes on the day, results).
//   completed  The end date has passed. The tournament is a record; nothing
//              changes.
//   cancelled  A cancelled tournament is a record too; nothing changes.
//
// "paid" comes before "ongoing" because a tournament can start with nobody
// paid (a free event, or no takers). The stages are ordered, and a field locked
// at one stage stays locked at every later one, so a tournament that is
// ongoing is treated as past "paid" whether or not anyone paid.
//
// This module is the single place the rule is written down. The PATCH route
// enforces it, the edit wizard disables what it locks, and
// guard_tournament_paid_fields (003_functions_triggers.sql) is the database's
// copy of the "paid" column list. The date-based stages are deliberately not in
// the database: they depend on today at the venue, and a second definition of
// that would drift from getTodayInTimeZone().

import { getTournamentDateState } from "@/lib/tournaments/datetime";

export type EditStage =
  | "draft"
  | "published"
  | "paid"
  | "ongoing"
  | "completed"
  | "cancelled";

/** The stages in the order a tournament moves through them. */
const STAGE_ORDER = [
  "draft",
  "published",
  "paid",
  "ongoing",
  "completed",
] as const satisfies readonly EditStage[];

type OrderedStage = (typeof STAGE_ORDER)[number];

/**
 * A field as the PATCH route names it. Mostly a `tournaments` column; `beneficiary`
 * stands for the nomination pair (beneficiary_organization_id and
 * beneficiary_accepted_at), which is written through its own route.
 */
export type EditableField =
  | "name"
  | "description"
  | "venue_name"
  | "venue_address"
  | "venue_state"
  | "venue_country"
  | "start_date"
  | "end_date"
  | "registration_deadline"
  | "format"
  | "time_control"
  | "is_fide_rated"
  | "is_mcf_rated"
  | "restrictions"
  | "entry_fees"
  | "prizes"
  | "max_participants"
  | "commission_rate"
  | "organizer_commission_pct"
  | "beneficiary";

/**
 * The first stage at which each field can no longer change. Nothing locks at
 * "published": publishing is what the publish validator guards, not a freeze.
 */
export const LOCKS_AT: Record<EditableField, OrderedStage> = {
  // What the player is paying, and what they can win.
  entry_fees: "paid",
  prizes: "paid",
  max_participants: "paid",
  commission_rate: "paid",
  organizer_commission_pct: "paid",
  beneficiary: "paid",

  // When and where it happens. Moving the dates or the region after somebody
  // paid changes whether they can attend at all, and the country decides which
  // payout rails the money moves on. A tournament that has to move is a
  // cancellation (with refunds), not an edit.
  start_date: "paid",
  end_date: "paid",
  venue_country: "paid",
  venue_state: "paid",

  // What kind of event it is, and who it's for. Tightening eligibility after
  // payment could disqualify a player who already paid; changing the time
  // control or rating status changes what they paid for.
  format: "paid",
  time_control: "paid",
  is_fide_rated: "paid",
  is_mcf_rated: "paid",
  restrictions: "paid",

  // Cosmetic until the tournament starts. A hall change within the same venue
  // is routine, and so is a corrected typo.
  name: "ongoing",
  venue_name: "ongoing",
  venue_address: "ongoing",
  // Extending or shortening the deadline doesn't change anyone's paid entry.
  // (It can't outlive the start date anyway: chk_registration_deadline.)
  registration_deadline: "ongoing",

  // The one place to post notices while the tournament runs.
  description: "completed",
};

export const EDITABLE_FIELDS = Object.keys(LOCKS_AT) as EditableField[];

/** True when `field` can still be changed at `stage`. */
export function isFieldEditable(
  field: EditableField,
  stage: EditStage,
): boolean {
  if (stage === "cancelled") return false;
  return STAGE_ORDER.indexOf(stage) < STAGE_ORDER.indexOf(LOCKS_AT[field]);
}

/** Every field locked at `stage`, in declaration order. */
export function lockedFields(stage: EditStage): EditableField[] {
  return EDITABLE_FIELDS.filter((f) => !isFieldEditable(f, stage));
}

/** False once nothing at all can be edited, so there's no point opening the editor. */
export function canEditAnything(stage: EditStage): boolean {
  return EDITABLE_FIELDS.some((f) => isFieldEditable(f, stage));
}

/**
 * Whether the stage depends on a paid registration. Past "published" every
 * paid-locked field is locked by the date anyway, so callers can skip asking
 * the database whether anyone paid.
 */
export function needsPaymentCheck(stage: EditStage): boolean {
  return stage === "published";
}

interface StageInput {
  status: string;
  startDate: string;
  endDate: string;
  /** Today's calendar date at the venue — see getTodayInTimeZone. */
  today: string;
  /**
   * Whether any registration payment has settled. Only consulted for a
   * published tournament that hasn't started; pass false when unknown and use
   * needsPaymentCheck to decide whether finding out is worth a query.
   */
  hasPaidRegistration: boolean;
}

/**
 * Where a tournament is in its life, for editing purposes.
 *
 * Drafts are exempt from the date stages: they carry placeholder dates (and
 * can't have registrations), so a date rule would make them uneditable.
 */
export function resolveEditStage({
  status,
  startDate,
  endDate,
  today,
  hasPaidRegistration,
}: StageInput): EditStage {
  if (status === "draft") return "draft";
  if (status === "cancelled") return "cancelled";

  const dateState = getTournamentDateState(startDate, endDate, today);
  if (dateState === "completed") return "completed";
  if (dateState === "ongoing") return "ongoing";
  return hasPaidRegistration ? "paid" : "published";
}

/** Why the fields locked at `stage` are locked, in words an organizer reads. */
export function lockReason(stage: EditStage): string {
  switch (stage) {
    case "paid":
      return "A player has already paid, so the fee, prizes, capacity, dates, region, format and eligibility are locked.";
    case "ongoing":
      return "This tournament has started. Only the description can still be edited.";
    case "completed":
      return "This tournament has ended and can no longer be edited.";
    case "cancelled":
      return "This tournament was cancelled and can no longer be edited.";
    default:
      return "";
  }
}
