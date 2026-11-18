import { afterEach, describe, expect, it } from "vitest";
import { classifyRegistration } from "../classify";
import type { PlayerRegistration } from "../types";

function registration(
  tournament: Partial<PlayerRegistration["tournament"]> = {},
  status: PlayerRegistration["status"] = "confirmed",
): PlayerRegistration {
  return {
    id: "reg-1",
    tournament: {
      id: "t1",
      slug: "kl-open",
      name: "KL Open",
      start_date: "2026-03-15",
      end_date: "2026-03-17",
      timezone: "Asia/Kuala_Lumpur",
      venue_name: "KLCC",
      venue_state: "Kuala Lumpur",
      format: {
        type: "rapid",
        system: "swiss",
        rounds: 7,
      } as PlayerRegistration["tournament"]["format"],
      time_control: {
        base_minutes: 10,
        increment_seconds: 5,
      } as PlayerRegistration["tournament"]["time_control"],
      status: "published",
      ...tournament,
    },
    fee_tier: "standard",
    entry_fee_cents: 5000,
    status,
    registered_at: "2026-02-22T12:00:00Z",
    confirmed_at: "2026-02-22T12:01:30Z",
    refund: null,
  };
}

// Noon in Kuala Lumpur (UTC+8) on the given calendar date.
const klNoon = (date: string) => new Date(`${date}T12:00:00+08:00`);

describe("classifyRegistration", () => {
  describe("a 3-day event (15–17 Mar)", () => {
    const reg = registration();

    it.each(["2026-03-15", "2026-03-16", "2026-03-17"])(
      "is Upcoming on %s while it is being played",
      (date) => {
        expect(classifyRegistration(reg, klNoon(date))).toBe("upcoming");
      },
    );

    it("is Upcoming before it starts", () => {
      expect(classifyRegistration(reg, klNoon("2026-03-10"))).toBe("upcoming");
    });

    it("moves to Past the day after end_date", () => {
      expect(classifyRegistration(reg, klNoon("2026-03-18"))).toBe("past");
    });
  });

  describe("a single-day event", () => {
    const reg = registration({
      start_date: "2026-03-15",
      end_date: "2026-03-15",
    });

    it("is Upcoming on the day", () => {
      expect(classifyRegistration(reg, klNoon("2026-03-15"))).toBe("upcoming");
    });

    it("is Past the next venue day", () => {
      expect(classifyRegistration(reg, klNoon("2026-03-16"))).toBe("past");
    });
  });

  describe("venue timezone, not the reader's", () => {
    const originalTz = process.env.TZ;
    afterEach(() => {
      process.env.TZ = originalTz;
    });

    // 20:00 UTC on the 17th is already 04:00 on the 18th in Kuala Lumpur:
    // the event is over at the venue though the reader's day may not be.
    const justAfterEnd = new Date("2026-03-17T20:00:00Z");
    // 15:30 UTC on the 17th is 23:30 on the 17th in Kuala Lumpur: still the
    // last day at the venue though a UTC+8 reader is about to roll over.
    const lastHourOfEnd = new Date("2026-03-17T15:30:00Z");

    it.each(["UTC", "Asia/Kuala_Lumpur", "America/Los_Angeles"])(
      "classifies the same with the device clock in %s",
      (tz) => {
        process.env.TZ = tz;
        const reg = registration();
        expect(classifyRegistration(reg, justAfterEnd)).toBe("past");
        expect(classifyRegistration(reg, lastHourOfEnd)).toBe("upcoming");
      },
    );

    it("follows each venue's own zone", () => {
      // 23:30 on the 17th in Jakarta (UTC+7) is already the 18th in Manila (UTC+8).
      const now = new Date("2026-03-17T16:30:00Z");
      expect(
        classifyRegistration(registration({ timezone: "Asia/Jakarta" }), now),
      ).toBe("upcoming");
      expect(
        classifyRegistration(registration({ timezone: "Asia/Manila" }), now),
      ).toBe("past");
    });
  });

  describe("cancellations are unchanged", () => {
    const duringEvent = klNoon("2026-03-16");

    it("puts a confirmed entry in a cancelled tournament under Cancelled", () => {
      const reg = registration({ status: "cancelled" });
      expect(classifyRegistration(reg, duringEvent)).toBe("cancelled");
      expect(classifyRegistration(reg, klNoon("2026-04-01"))).toBe("cancelled");
    });

    it.each(["cancelled_payment", "failed_payment"] as const)(
      "puts %s under Cancelled, upcoming or past",
      (status) => {
        const reg = registration({}, status);
        expect(classifyRegistration(reg, duringEvent)).toBe("cancelled");
        expect(classifyRegistration(reg, klNoon("2026-04-01"))).toBe(
          "cancelled",
        );
      },
    );

    it("files an unpaid entry by date like any other", () => {
      const reg = registration({}, "pending_payment");
      expect(classifyRegistration(reg, duringEvent)).toBe("upcoming");
      expect(classifyRegistration(reg, klNoon("2026-04-01"))).toBe("past");
    });
  });
});
