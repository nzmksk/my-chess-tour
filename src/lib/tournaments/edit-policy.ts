import { getTournamentDateState } from "@/lib/tournaments/datetime";

export type EditStage =
  | "draft"
  | "published"
  | "paid"
  | "ongoing"
  | "completed"
  | "cancelled";

const STAGE_ORDER = [
  "draft",
  "published",
  "paid",
  "ongoing",
  "completed",
] as const satisfies readonly EditStage[];

type OrderedStage = (typeof STAGE_ORDER)[number];

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

export const LOCKS_AT: Record<EditableField, OrderedStage> = {
  entry_fees: "paid",
  prizes: "paid",
  commission_rate: "paid",
  organizer_commission_pct: "paid",
  beneficiary: "paid",

  start_date: "paid",
  end_date: "paid",
  venue_country: "paid",
  venue_state: "paid",

  format: "paid",
  time_control: "paid",
  is_fide_rated: "paid",
  is_mcf_rated: "paid",
  restrictions: "paid",

  name: "ongoing",
  venue_name: "ongoing",
  venue_address: "ongoing",
  registration_deadline: "ongoing",
  max_participants: "ongoing",

  description: "completed",
};

export const INCREASE_ONLY_FROM: Partial<Record<EditableField, OrderedStage>> =
  {
    max_participants: "paid",
  };

export const EDITABLE_FIELDS = Object.keys(LOCKS_AT) as EditableField[];

export function isFieldEditable(
  field: EditableField,
  stage: EditStage,
): boolean {
  if (stage === "cancelled") return false;
  return STAGE_ORDER.indexOf(stage) < STAGE_ORDER.indexOf(LOCKS_AT[field]);
}

export function isIncreaseOnly(
  field: EditableField,
  stage: EditStage,
): boolean {
  const from = INCREASE_ONLY_FROM[field];
  if (from === undefined || !isFieldEditable(field, stage)) return false;
  return (
    STAGE_ORDER.indexOf(stage as OrderedStage) >= STAGE_ORDER.indexOf(from)
  );
}

export function isChangeAllowed(
  field: EditableField,
  stage: EditStage,
  before: unknown,
  after: unknown,
): boolean {
  if (!isFieldEditable(field, stage)) return false;
  if (!isIncreaseOnly(field, stage)) return true;
  return (
    typeof before === "number" && typeof after === "number" && after > before
  );
}

export function lockedFields(stage: EditStage): EditableField[] {
  return EDITABLE_FIELDS.filter((f) => !isFieldEditable(f, stage));
}

export function canEditAnything(stage: EditStage): boolean {
  return EDITABLE_FIELDS.some((f) => isFieldEditable(f, stage));
}

export function needsPaymentCheck(stage: EditStage): boolean {
  return stage === "published";
}

interface StageInput {
  status: string;
  startDate: string;
  endDate: string;
  today: string;
  hasPaidRegistration: boolean;
}

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

export function lockReason(stage: EditStage): string {
  switch (stage) {
    case "paid":
      return "A player has already paid, so the fee, prizes, dates, region, format and eligibility are locked, and capacity can only be increased.";
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
