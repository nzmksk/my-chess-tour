import { describe, it, expect } from "vitest";
import {
  EDITABLE_FIELDS,
  canEditAnything,
  isChangeAllowed,
  isFieldEditable,
  isIncreaseOnly,
  lockedFields,
  needsPaymentCheck,
  resolveEditStage,
  type EditStage,
} from "../edit-policy";

const TODAY = "2026-11-15";

function stage(
  overrides: Partial<Parameters<typeof resolveEditStage>[0]> = {},
): EditStage {
  return resolveEditStage({
    status: "published",
    startDate: "2026-12-01",
    endDate: "2026-12-02",
    today: TODAY,
    hasPaidRegistration: false,
    ...overrides,
  });
}

describe("resolveEditStage", () => {
  it("keeps a draft a draft even with past placeholder dates", () => {
    expect(
      stage({
        status: "draft",
        startDate: "2020-01-01",
        endDate: "2020-01-02",
      }),
    ).toBe("draft");
  });

  it("is published before anyone pays", () => {
    expect(stage()).toBe("published");
  });

  it("holds a tournament waiting for its prize pool to the published rules", () => {
    expect(stage({ status: "pending_funding" })).toBe("published");
    expect(stage({ status: "pending_funding", startDate: TODAY, endDate: TODAY })).toBe(
      "ongoing",
    );
  });

  it("is paid once a registration payment settles", () => {
    expect(stage({ hasPaidRegistration: true })).toBe("paid");
  });

  it("is ongoing from the start date, paid or not", () => {
    expect(stage({ startDate: TODAY, endDate: TODAY })).toBe("ongoing");
    expect(
      stage({ startDate: TODAY, endDate: TODAY, hasPaidRegistration: true }),
    ).toBe("ongoing");
  });

  it("is completed once the end date has passed", () => {
    expect(stage({ startDate: "2026-11-01", endDate: "2026-11-14" })).toBe(
      "completed",
    );
  });

  it("is cancelled regardless of dates", () => {
    expect(stage({ status: "cancelled" })).toBe("cancelled");
    expect(
      stage({
        status: "cancelled",
        startDate: "2020-01-01",
        endDate: "2020-01-02",
      }),
    ).toBe("cancelled");
  });
});

describe("isFieldEditable", () => {
  it("leaves everything editable on a draft and on an unpaid listing", () => {
    for (const f of EDITABLE_FIELDS) {
      expect(isFieldEditable(f, "draft")).toBe(true);
      expect(isFieldEditable(f, "published")).toBe(true);
    }
  });

  it("locks what the player paid for at the first payment", () => {
    expect(lockedFields("paid")).toEqual([
      "entry_fees",
      "prizes",
      "commission_rate",
      "organizer_commission_pct",
      "beneficiary",
      "start_date",
      "end_date",
      "venue_country",
      "venue_state",
      "format",
      "time_control",
      "is_fide_rated",
      "is_mcf_rated",
      "restrictions",
    ]);
  });

  it("keeps cosmetic fields and the deadline editable after payment", () => {
    for (const f of [
      "name",
      "description",
      "venue_name",
      "venue_address",
      "registration_deadline",
    ] as const) {
      expect(isFieldEditable(f, "paid")).toBe(true);
    }
  });

  it("leaves only the description editable once started", () => {
    expect(
      EDITABLE_FIELDS.filter((f) => isFieldEditable(f, "ongoing")),
    ).toEqual(["description"]);
  });

  it("locks everything once ended or cancelled", () => {
    expect(lockedFields("completed")).toEqual(EDITABLE_FIELDS);
    expect(lockedFields("cancelled")).toEqual(EDITABLE_FIELDS);
  });

  it("never unlocks a field as the tournament moves on", () => {
    const order: EditStage[] = [
      "draft",
      "published",
      "paid",
      "ongoing",
      "completed",
    ];
    for (const f of EDITABLE_FIELDS) {
      const editable = order.map((s) => isFieldEditable(f, s));
      const firstLocked = editable.indexOf(false);
      if (firstLocked === -1) continue;
      expect(editable.slice(firstLocked).every((e) => !e)).toBe(true);
    }
  });
});

describe("capacity", () => {
  it("can move either way until someone pays", () => {
    for (const s of ["draft", "published"] as const) {
      expect(isIncreaseOnly("max_participants", s)).toBe(false);
      expect(isChangeAllowed("max_participants", s, 32, 16)).toBe(true);
      expect(isChangeAllowed("max_participants", s, 32, 64)).toBe(true);
    }
  });

  it("can only go up after the first payment", () => {
    expect(isFieldEditable("max_participants", "paid")).toBe(true);
    expect(isIncreaseOnly("max_participants", "paid")).toBe(true);
    expect(isChangeAllowed("max_participants", "paid", 32, 64)).toBe(true);
    expect(isChangeAllowed("max_participants", "paid", 32, 16)).toBe(false);
    expect(isChangeAllowed("max_participants", "paid", 32, null)).toBe(false);
  });

  it("locks outright once the tournament starts", () => {
    for (const s of ["ongoing", "completed", "cancelled"] as const) {
      expect(isIncreaseOnly("max_participants", s)).toBe(false);
      expect(isChangeAllowed("max_participants", s, 32, 64)).toBe(false);
    }
  });

  it("is the only increase-only field", () => {
    expect(EDITABLE_FIELDS.filter((f) => isIncreaseOnly(f, "paid"))).toEqual([
      "max_participants",
    ]);
  });
});

describe("isChangeAllowed", () => {
  it("follows isFieldEditable for every other field", () => {
    const stages: EditStage[] = [
      "draft",
      "published",
      "paid",
      "ongoing",
      "completed",
      "cancelled",
    ];
    for (const s of stages) {
      for (const f of EDITABLE_FIELDS) {
        if (f === "max_participants") continue;
        expect(isChangeAllowed(f, s, "a", "b")).toBe(isFieldEditable(f, s));
      }
    }
  });
});

describe("canEditAnything", () => {
  it("is false only once ended or cancelled", () => {
    expect(canEditAnything("draft")).toBe(true);
    expect(canEditAnything("published")).toBe(true);
    expect(canEditAnything("paid")).toBe(true);
    expect(canEditAnything("ongoing")).toBe(true);
    expect(canEditAnything("completed")).toBe(false);
    expect(canEditAnything("cancelled")).toBe(false);
  });
});

describe("needsPaymentCheck", () => {
  it("only asks about payments when the dates haven't already decided", () => {
    expect(needsPaymentCheck("published")).toBe(true);
    for (const s of [
      "draft",
      "paid",
      "ongoing",
      "completed",
      "cancelled",
    ] as const) {
      expect(needsPaymentCheck(s)).toBe(false);
    }
  });
});
