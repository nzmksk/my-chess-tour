import { describe, expect, it } from "vitest";
import { eighteenthBirthday, minorAgeOut } from "../age-out";

describe("eighteenthBirthday", () => {
  it("adds 18 years", () => {
    expect(eighteenthBirthday("2008-11-25")).toBe("2026-11-25");
  });

  it("moves 29 February to the 28th in a common year, as Postgres does", () => {
    expect(eighteenthBirthday("2008-02-29")).toBe("2026-02-28");
    expect(eighteenthBirthday("2010-02-28")).toBe("2028-02-28");
    expect(eighteenthBirthday("2012-02-29")).toBe("2030-02-28");
  });

  it("rejects anything but a calendar date", () => {
    expect(eighteenthBirthday("25/11/2008")).toBeNull();
  });
});

describe("minorAgeOut", () => {
  const minor = (date_of_birth: string | null) => ({
    basis: "minor",
    date_of_birth,
  });

  it("is nothing for a child more than 30 days from 18", () => {
    expect(minorAgeOut(minor("2010-01-01"), "2026-11-25").state).toBe("none");
  });

  it("is upcoming within 30 days of the birthday", () => {
    expect(minorAgeOut(minor("2008-12-20"), "2026-11-25")).toEqual({
      state: "upcoming",
      turns18On: "2026-12-20",
      accessEndsOn: "2027-01-19",
    });
  });

  it("is the grace period from the birthday itself", () => {
    expect(minorAgeOut(minor("2008-11-25"), "2026-11-25")).toEqual({
      state: "grace",
      turns18On: "2026-11-25",
      accessEndsOn: "2026-12-25",
    });
  });

  it("is nothing on an adult basis or without a date of birth", () => {
    expect(
      minorAgeOut(
        { basis: "authorised", date_of_birth: "2008-11-25" },
        "2026-11-25",
      ).state,
    ).toBe("none");
    expect(minorAgeOut(minor(null), "2026-11-25").state).toBe("none");
  });
});
