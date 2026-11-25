import { addCalendarDays } from "@/lib/tournaments/datetime";

export const AGE_OUT_NOTICE_DAYS = 30;
export const AGE_OUT_GRACE_DAYS = 30;

type AgeOutState = "none" | "upcoming" | "grace";

export interface MinorAgeOut {
  state: AgeOutState;
  turns18On: string | null;
  accessEndsOn: string | null;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function eighteenthBirthday(dateOfBirth: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  if (!match) return null;
  const year = Number(match[1]) + 18;
  const month = match[2];
  let day = match[3];
  if (month === "02" && day === "29" && !isLeapYear(year)) day = "28";
  return `${String(year).padStart(4, "0")}-${month}-${day}`;
}

export function minorAgeOut(
  guardianship: { basis: string; date_of_birth: string | null },
  today: string,
): MinorAgeOut {
  const none: MinorAgeOut = {
    state: "none",
    turns18On: null,
    accessEndsOn: null,
  };
  if (guardianship.basis !== "minor" || !guardianship.date_of_birth)
    return none;

  const turns18On = eighteenthBirthday(guardianship.date_of_birth);
  if (!turns18On) return none;
  const accessEndsOn = addCalendarDays(turns18On, AGE_OUT_GRACE_DAYS);

  if (turns18On <= today) return { state: "grace", turns18On, accessEndsOn };
  if (turns18On <= addCalendarDays(today, AGE_OUT_NOTICE_DAYS)) {
    return { state: "upcoming", turns18On, accessEndsOn };
  }
  return none;
}
