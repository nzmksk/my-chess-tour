import { describe, it, expect } from "vitest";
import {
  PLACEHOLDER_DATE,
  PLACEHOLDER_DEADLINE,
  validatePublishable,
  type PublishableTournament,
} from "../publish-validation";

const TODAY = "2026-11-15";
const NOW = "2026-11-15T04:00:00.000Z";

const COMPLETE: PublishableTournament = {
  name: "KL Open",
  venue_name: "Dewan",
  venue_state: "Selangor",
  venue_address: "1 Jalan",
  start_date: "2026-12-01",
  end_date: "2026-12-02",
  registration_deadline: "2026-11-30T15:59:00+00:00",
  format: { type: "rapid", system: "swiss", rounds: 7 },
  time_control: { base_minutes: 15 },
  entry_fees: { standard: { amount_cents: 5000 } },
  prizes: null,
};

const opts = { today: TODAY, now: NOW };

describe("validatePublishable", () => {
  it("passes a complete tournament", () => {
    expect(validatePublishable(COMPLETE, opts)).toEqual([]);
  });

  it("reports blanked required fields", () => {
    expect(
      validatePublishable({ ...COMPLETE, venue_address: "  " }, opts),
    ).toEqual(["Venue address is required"]);
  });

  it("treats placeholder dates as missing", () => {
    expect(
      validatePublishable(
        {
          ...COMPLETE,
          start_date: PLACEHOLDER_DATE,
          end_date: PLACEHOLDER_DATE,
          registration_deadline: PLACEHOLDER_DEADLINE,
        },
        opts,
      ),
    ).toEqual([
      "Start date must be a future date",
      "End date is required",
      "Registration deadline must be a future date",
    ]);
  });

  it("requires future dates by default", () => {
    expect(
      validatePublishable(
        {
          ...COMPLETE,
          start_date: TODAY,
          registration_deadline: "2026-11-15T03:00:00+00:00",
        },
        opts,
      ),
    ).toEqual([
      "Start date must be a future date",
      "Registration deadline must be a future date",
    ]);
  });

  // An edit that doesn't touch a date that has already passed (a closed
  // registration) must not be refused for it.
  it("can skip the future-date checks for dates that aren't changing", () => {
    expect(
      validatePublishable(
        { ...COMPLETE, registration_deadline: "2026-11-15T03:00:00+00:00" },
        { ...opts, requireFutureDeadline: false },
      ),
    ).toEqual([]);
    expect(
      validatePublishable(
        { ...COMPLETE, start_date: TODAY },
        { ...opts, requireFutureStartDate: false },
      ),
    ).toEqual([]);
  });

  it("compares the deadline as an instant, not as text", () => {
    // Same instant as NOW in a different offset: not in the future.
    expect(
      validatePublishable(
        { ...COMPLETE, registration_deadline: "2026-11-15T12:00:00+08:00" },
        opts,
      ),
    ).toEqual(["Registration deadline must be a future date"]);
  });
});
