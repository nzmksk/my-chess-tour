import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParticipantRecipients } from "@/services/email/participant-recipients";

const { mockFrom, tables, mockAwarded, mockPaid, mockLoadContacts } =
  vi.hoisted(() => {
    const tables: Record<string, Array<{ data: unknown; error: unknown }>> = {};

    function makeBuilder(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "maybeSingle"]) {
        b[m] = vi.fn(() => b);
      }
      b.then = (
        onfulfilled: (v: unknown) => unknown,
        onrejected?: (r: unknown) => unknown,
      ) =>
        Promise.resolve(
          tables[table]?.shift() ?? { data: null, error: null },
        ).then(onfulfilled, onrejected);
      return b;
    }

    return {
      tables,
      mockFrom: vi.fn((table: string) => makeBuilder(table)),
      mockAwarded: vi.fn(),
      mockPaid: vi.fn(),
      mockLoadContacts: vi.fn(),
    };
  });

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("@/services/email/email", () => ({
  sendPrizeAwardedEmail: mockAwarded,
  sendPrizePaidEmail: mockPaid,
  sendAdminPayoutAlertEmail: vi.fn(),
}));

vi.mock("@/services/payouts/recipients", () => ({
  loadPlatformAdminRecipients: vi.fn(),
}));

vi.mock("@/services/email/participant-recipients", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/email/participant-recipients")
  >()),
  loadParticipantRecipients: mockLoadContacts,
}));

import { notifyPrizeAwarded, notifyPrizePaid } from "../notify";

const AWARD = "66666666-6666-4666-8666-666666666666";
const WINNER = "dddddddd-0000-4000-8000-000000000001";

function contacts(
  participantName: string,
  guardians: Array<[string, string]>,
  own: Array<[string, string]> = [],
  participantCanSignIn = true,
): ParticipantRecipients {
  return {
    participantName,
    participantCanSignIn,
    recipients: new Map(
      [...guardians, ...own].map(([email, name]) => [
        email.toLowerCase(),
        { email, name },
      ]),
    ),
    participantAddresses: new Set(own.map(([email]) => email.toLowerCase())),
  };
}

function givenAward(overrides: Record<string, unknown> = {}) {
  tables.prize_awards = [
    {
      data: {
        id: AWARD,
        category: "Open",
        place: "1st",
        amount_cents: 30000,
        settled_amount_cents: 30000,
        chip_receipt_url: "https://chip.test/r/1",
        user_id: WINNER,
        tournament: { name: "Merdeka Open" },
        bank: { account_number: "514100000101" },
        ...overrides,
      },
      error: null,
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  mockAwarded.mockResolvedValue(undefined);
  mockPaid.mockResolvedValue(undefined);
  mockLoadContacts.mockResolvedValue(
    contacts("Aisyah Karim", [], [["aisyah@example.com", "Aisyah"]]),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("notifyPrizeAwarded", () => {
  it("emails the winner where the prize will go", async () => {
    givenAward();
    tables.player_bank_accounts = [
      {
        data: { account_number: "514100000101", status: "verified" },
        error: null,
      },
    ];
    await notifyPrizeAwarded(AWARD);

    expect(mockLoadContacts).toHaveBeenCalledWith(WINNER);
    expect(mockAwarded).toHaveBeenCalledWith("aisyah@example.com", {
      recipientName: "Aisyah",
      tournamentName: "Merdeka Open",
      prizeName: "Open — 1st",
      amountCents: 30000,
      accountLast4: "0101",
      accountRejected: false,
      aboutPlayer: null,
      canActInSettings: true,
    });
  });

  it("tells a dependent's guardians, naming the dependent (#716)", async () => {
    mockLoadContacts.mockResolvedValue(
      contacts("Aina Rahman", [
        ["mum@example.com", "Siti"],
        ["dad@example.com", "Rahman"],
      ]),
    );
    givenAward();
    tables.player_bank_accounts = [{ data: null, error: null }];
    await notifyPrizeAwarded(AWARD);

    expect(mockAwarded).toHaveBeenCalledTimes(2);
    expect(mockAwarded).toHaveBeenCalledWith(
      "mum@example.com",
      expect.objectContaining({
        recipientName: "Siti",
        aboutPlayer: "Aina Rahman",
      }),
    );
    expect(mockAwarded).toHaveBeenCalledWith(
      "dad@example.com",
      expect.objectContaining({
        recipientName: "Rahman",
        aboutPlayer: "Aina Rahman",
      }),
    );
  });

  it("doesn't ask a dependent with no login for bank details in Settings (#716)", async () => {
    mockLoadContacts.mockResolvedValue(
      contacts("Badrul Hisham", [], [["badrul@example.com", "Badrul"]], false),
    );
    givenAward();
    tables.player_bank_accounts = [{ data: null, error: null }];
    await notifyPrizeAwarded(AWARD);

    expect(mockAwarded).toHaveBeenCalledWith(
      "badrul@example.com",
      expect.objectContaining({ aboutPlayer: null, canActInSettings: false }),
    );
  });

  it("passes a rejected account on", async () => {
    givenAward();
    tables.player_bank_accounts = [
      {
        data: { account_number: "514100000101", status: "rejected" },
        error: null,
      },
    ];
    await notifyPrizeAwarded(AWARD);

    expect(mockAwarded).toHaveBeenCalledWith(
      "aisyah@example.com",
      expect.objectContaining({ accountLast4: null, accountRejected: true }),
    );
  });

  it("sends nothing when there is nobody to email", async () => {
    mockLoadContacts.mockResolvedValue(contacts("Aina Rahman", []));
    givenAward();
    await notifyPrizeAwarded(AWARD);
    expect(mockAwarded).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it("sends nothing for an award with no winner record", async () => {
    givenAward({ user_id: null });
    await notifyPrizeAwarded(AWARD);
    expect(mockLoadContacts).not.toHaveBeenCalled();
    expect(mockAwarded).not.toHaveBeenCalled();
  });

  it("never throws when the send fails", async () => {
    givenAward();
    mockAwarded.mockRejectedValue(new Error("resend down"));
    await expect(notifyPrizeAwarded(AWARD)).resolves.toBeUndefined();
  });
});

describe("notifyPrizePaid", () => {
  it("emails the winner the amount, account and receipt", async () => {
    givenAward();
    await notifyPrizePaid(AWARD);

    expect(mockPaid).toHaveBeenCalledWith("aisyah@example.com", {
      recipientName: "Aisyah",
      tournamentName: "Merdeka Open",
      prizeName: "Open — 1st",
      amountCents: 30000,
      accountLast4: "0101",
      receiptUrl: "https://chip.test/r/1",
      aboutPlayer: null,
    });
  });

  it("tells a dependent's guardian and their contact email (#716)", async () => {
    mockLoadContacts.mockResolvedValue(
      contacts(
        "Badrul Hisham",
        [["carer@example.com", "Hana"]],
        [["badrul@example.com", "Badrul"]],
      ),
    );
    givenAward();
    await notifyPrizePaid(AWARD);

    expect(mockPaid).toHaveBeenCalledWith(
      "carer@example.com",
      expect.objectContaining({ aboutPlayer: "Badrul Hisham" }),
    );
    expect(mockPaid).toHaveBeenCalledWith(
      "badrul@example.com",
      expect.objectContaining({ recipientName: "Badrul", aboutPlayer: null }),
    );
  });

  it("logs and returns when the award can't be loaded", async () => {
    tables.prize_awards = [{ data: null, error: { message: "boom" } }];
    await expect(notifyPrizePaid(AWARD)).resolves.toBeUndefined();
    expect(mockPaid).not.toHaveBeenCalled();
  });
});
