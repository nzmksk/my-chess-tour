import { NextResponse } from "next/server";
import { minorAgeOut } from "@/lib/guardianship/age-out";
import {
  formatCalendarDate,
  getTodayInTimeZone,
} from "@/lib/tournaments/datetime";

export function agedOutResponse(
  dependent: {
    first_name: string;
    basis: string;
    date_of_birth: string | null;
  },
  today: string = getTodayInTimeZone(),
): NextResponse | null {
  const ageOut = minorAgeOut(dependent, today);
  if (ageOut.state !== "grace" || !ageOut.turns18On) return null;
  return NextResponse.json(
    {
      error: {
        code: "AGED_OUT",
        message: `${dependent.first_name} turned 18 on ${formatCalendarDate(ageOut.turns18On)}. You can still view their record and hand it over to them, but you can no longer change it.`,
      },
    },
    { status: 409 },
  );
}
