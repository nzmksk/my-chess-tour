import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParticipantRecipients } from "@/services/email/participant-recipients";

const { mockFrom, tables, mockConfirm, mockLoadContacts } = vi.hoisted(() => {
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
    mockLoadContacts: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("@/services/email/email", () => ({
  sendRegistrationConfirmationEmail: mockConfirm,
}));

vi.mock("@/services/email/participant-recipients", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/email/participant-recipients")>()),
  loadParticipantRecipients: mockLoadContacts,
}));

import { notifyRegistrationConfirmed } from "../notify";

const REG = "44444444-4444-4444-4444-444444444444";
const PLAYER = "dddddddd-0000-4000-8000-000000000001";

function contacts(
  participantName: string,
  guardians: Array<[string, string]>,
  own: Array<[string, string]> = [],
  participantCanSignIn = true,
): ParticipantRecipients {
  const recipients = new Map(
    [...guardians, ...own].map(([email, name]) => [email.toLowerCase(), { email, name }]),
  );
  return {
    participantName,
    participantCanSignIn,
    recipients,
    participantAddresses: new Set(own.map(([email]) => email.toLowerCase())),
  };
}

function givenRegistration(overrides: Record<string, unknown> = {}) {
  tables.registrations = [
    {
      data: {
        status: "confirmed",
        user_id: PLAYER,
        tournament: {
          name: "KL Open",
          slug: "kl-open-2026",
          start_date: "2026-08-10",
          end_date: "2026-08-12",
          timezone: "Asia/Kuala_Lumpur",
          venue_name: "Dewan Besar",
          venue_state: "Selangor",
        },
        payment: {
          gross_amount_cents: 5500,
          payer: { email: "farid@example.com", first_name: "Farid" },
        },
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
  mockLoadContacts.mockResolvedValue(
    contacts("Farid Hamzah", [], [["farid@example.com", "Farid"]]),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("notifyRegistrationConfirmed", () => {
  it("emails the player the tournament, venue-local dates, venue and fee paid", async () => {
    givenRegistration();
    await notifyRegistrationConfirmed(REG);

    expect(mockLoadContacts).toHaveBeenCalledWith(PLAYER);
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith("farid@example.com", {
      recipientName: "Farid",
      aboutPlayer: null,
      tournamentName: "KL Open",
      tournamentSlug: "kl-open-2026",
      tournamentDates: "10 Aug – 12 Aug 2026 (MYT)",
      venue: "Dewan Besar, Selangor",
      feePaidCents: 5500,
    });
  });

  it("emails a dependent's guardians, naming the dependent (#716)", async () => {
    mockLoadContacts.mockResolvedValue(
      contacts("Aina Rahman", [
        ["mum@example.com", "Siti"],
        ["dad@example.com", "Rahman"],
      ]),
    );
    givenRegistration({
      payment: {
        gross_amount_cents: 5500,
        payer: { email: "mum@example.com", first_name: "Siti" },
      },
    });
    await notifyRegistrationConfirmed(REG);

    expect(mockConfirm).toHaveBeenCalledTimes(2);
    expect(mockConfirm).toHaveBeenCalledWith(
      "mum@example.com",
      expect.objectContaining({ recipientName: "Siti", aboutPlayer: "Aina Rahman" }),
    );
    expect(mockConfirm).toHaveBeenCalledWith(
      "dad@example.com",
      expect.objectContaining({ recipientName: "Rahman", aboutPlayer: "Aina Rahman" }),
    );
  });

  it("adds an adult dependent's contact email, written to them", async () => {
    mockLoadContacts.mockResolvedValue(
      contacts("Badrul Hisham", [["carer@example.com", "Hana"]], [["badrul@example.com", "Badrul"]]),
    );
    givenRegistration({
      payment: {
        gross_amount_cents: 5500,
        payer: { email: "carer@example.com", first_name: "Hana" },
      },
    });
    await notifyRegistrationConfirmed(REG);

    expect(mockConfirm).toHaveBeenCalledWith(
      "badrul@example.com",
      expect.objectContaining({ recipientName: "Badrul", aboutPlayer: null }),
    );
    expect(mockConfirm).toHaveBeenCalledWith(
      "carer@example.com",
      expect.objectContaining({ aboutPlayer: "Badrul Hisham" }),
    );
  });

  it("also tells a payer who isn't a guardian any more", async () => {
    mockLoadContacts.mockResolvedValue(contacts("Aina Rahman", [["mum@example.com", "Siti"]]));
    givenRegistration({
      payment: {
        gross_amount_cents: 5500,
        payer: { email: "Former@Example.com", first_name: "Fiona" },
      },
    });
    await notifyRegistrationConfirmed(REG);

    expect(mockConfirm).toHaveBeenCalledWith(
      "Former@Example.com",
      expect.objectContaining({ recipientName: "Fiona", aboutPlayer: "Aina Rahman" }),
    );
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

  it("sends nothing when there is nobody to email", async () => {
    mockLoadContacts.mockResolvedValue(contacts("Aina Rahman", []));
    givenRegistration({ payment: null });
    await notifyRegistrationConfirmed(REG);
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("sends nothing when the recipients can't be loaded", async () => {
    mockLoadContacts.mockResolvedValue(null);
    givenRegistration();
    await notifyRegistrationConfirmed(REG);
    expect(mockConfirm).not.toHaveBeenCalled();
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
