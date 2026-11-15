import { NextResponse } from "next/server";
import {
  getTodayInTimeZone,
  resolveTimeZone,
} from "@/lib/tournaments/datetime";
import {
  isFieldEditable,
  lockReason,
  resolveEditStage,
} from "@/lib/tournaments/edit-policy";

/** The tournament columns the date stages are read from. */
export const BENEFICIARY_LOCK_COLUMNS = "status, start_date, end_date, timezone";

export interface BeneficiaryLockTournament {
  status: string;
  start_date: string;
  end_date: string;
  timezone: string | null;
}

/**
 * Whether the edit policy still lets this tournament's payout beneficiary
 * change, judged by status and dates alone. The beneficiary locks once the
 * tournament starts (or is cancelled), the same as every other field.
 *
 * The "paid" stage is left to guard_tournament_paid_fields, which refuses the
 * nomination RPCs' writes once a registration has been paid. The date stages
 * aren't in the database (see src/lib/tournaments/edit-policy.ts), so they
 * are checked here.
 */
export function beneficiaryStage(t: BeneficiaryLockTournament) {
  const stage = resolveEditStage({
    status: t.status,
    startDate: t.start_date,
    endDate: t.end_date,
    today: getTodayInTimeZone(resolveTimeZone(t.timezone)),
    hasPaidRegistration: false,
  });
  return { stage, editable: isFieldEditable("beneficiary", stage) };
}

/**
 * Nominating, withdrawing, accepting and declining all change who receives
 * the payout. Returns the 409 to send when the dates have locked that, else
 * null.
 */
export function beneficiaryLockResponse(
  t: BeneficiaryLockTournament,
): NextResponse | null {
  const { stage, editable } = beneficiaryStage(t);
  if (editable) return null;
  return NextResponse.json(
    { error: { code: "CONFLICT", message: lockReason(stage) } },
    { status: 409 },
  );
}
