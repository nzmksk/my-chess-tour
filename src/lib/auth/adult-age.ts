import { getTodayInTimeZone } from "@/lib/tournaments/datetime";

const ADULT_AGE = 18;

export const UNDER_18_SELF_ACCOUNT_MESSAGE =
  "You must be 18 or over to hold your own account. Under-18s take part through a parent or guardian's account.";

export function isUnderAdultAge(
  dateOfBirth: string,
  today: string = getTodayInTimeZone(),
): boolean {
  const year = Number(today.slice(0, 4)) - ADULT_AGE;
  const adultBornOnOrBefore = `${String(year).padStart(4, "0")}${today.slice(4)}`;
  return dateOfBirth > adultBornOnOrBefore;
}
