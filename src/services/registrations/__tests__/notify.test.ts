import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, tables, mockConfirm } = vi.hoisted(() => {
  const tables: Record<string, Array<{ data: unknown; error: unknown }>> = {};

  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "single"]) {
      b[m] = vi.fn(() => b);
    }
    b.then = (
      onfulfilled: (v: unknown) => unknown,
      onrejected?: (r: unknown) => unknown,
    ) =>
      Promise.resolve(tables[table]?.shift() ?? { data: null, error: null }).then(
        onfulfilled,
        onrejected,
      );
    return b;
  }

  return {
    tables,
    mockFrom: vi.fn((table: string) => makeBuilder(table)),
    mockConfirm: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("@/services/email/email", () => ({
  sendRegistrationConfirmationEmail: mockConfirm,
}));

import { notifyRegistrationConfirmed } from "../notify";

const REG = "44444444-4444-4444-4444-444444444444";

function givenRegistration(overrides: Record<string, unknown> = {}) {
  tables.registrations = [
    {
      data: {
        status: "confirmed",
        user: { email: "farid@example.com", first_name: "Farid" },
        tournament: {
          name: "KL Open",
          slug: "kl-open-2026",
          start_date: "2026-08-10",
          end_date: "2026-08-12",
          timezone: "Asia/Kuala_Lumpur",
          venue_name: "Dewan Besar",
          venue_state: "Selangor",
        },
        payment: { gross_amount_cents: 5500 },
        ...overrides,
      },
      error: null,
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  mockConfirm.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("notifyRegistrationConfirmed", () => {
  it("emails the player the tournament, venue-local dates, venue and fee paid", async () => {
    givenRegistration();
    await notifyRegistrationConfirmed(REG);

    expect(mockConfirm).toHaveBeenCalledWith("farid@example.com", {
      playerName: "Farid",
      tournamentName: "KL Open",
      tournamentSlug: "kl-open-2026",
      tournamentDates: "10 Aug – 12 Aug 2026 (MYT)",
      venue: "Dewan Besar, Selangor",
      feePaidCents: 5500,
    });
  });

  it("names the venue's own timezone", async () => {
    givenRegistration({
      tournament: {
        name: "Bangkok Rapid",
        slug: "bkk",
        start_date: "2026-09-05",
        end_date: "2026-09-05",
        timezone: "Asia/Bangkok",
        venue_name: "Hall",
        venue_state: null,
      },
    });
    await notifyRegistrationConfirmed(REG);

    expect(mockConfirm).toHaveBeenCalledWith(
      "farid@example.com",
      expect.objectContaining({ tournamentDates: "5 Sept 2026 (ICT)", venue: "Hall" }),
    );
  });

  it("reports a free registration as 0 when there is no payment amount", async () => {
    givenRegistration({ payment: null });
    await notifyRegistrationConfirmed(REG);
    expect(mockConfirm).toHaveBeenCalledWith(
      "farid@example.com",
      expect.objectContaining({ feePaidCents: 0 }),
    );
  });

  it("sends nothing unless the registration is confirmed", async () => {
    givenRegistration({ status: "cancelled_payment" });
    await notifyRegistrationConfirmed(REG);
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("sends nothing when the player has no email address", async () => {
    givenRegistration({ user: null });
    await notifyRegistrationConfirmed(REG);
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("logs and returns when the registration can't be loaded", async () => {
    tables.registrations = [{ data: null, error: { message: "boom" } }];
    await expect(notifyRegistrationConfirmed(REG)).resolves.toBeUndefined();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("never throws when the send fails", async () => {
    givenRegistration();
    mockConfirm.mockRejectedValue(new Error("resend down"));
    await expect(notifyRegistrationConfirmed(REG)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
