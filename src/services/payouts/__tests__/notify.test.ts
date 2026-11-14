import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, mockRpc, tables, mockAlert, mockNomination, mockReview, mockResponse } = vi.hoisted(() => {
  const tables: Record<string, Array<{ data: unknown; error: unknown }>> = {};

  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "single", "maybeSingle"]) {
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
    mockRpc: vi.fn(),
    mockAlert: vi.fn(),
    mockNomination: vi.fn(),
    mockReview: vi.fn(),
    mockResponse: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));

vi.mock("@/services/email/email", () => ({
  sendAdminPayoutAlertEmail: mockAlert,
  sendBeneficiaryNominationEmail: mockNomination,
  sendPayoutReviewEmail: mockReview,
  sendNominationResponseEmail: mockResponse,
}));

import {
  notifyAdminsOfPayout,
  notifyBeneficiaryNominated,
  notifyNominationResponded,
  notifyPayoutReviewed,
} from "../notify";

const ID = "11111111-1111-1111-1111-111111111111";

function givenPayout(overrides: Record<string, unknown> = {}) {
  tables.payouts = [
    {
      data: {
        id: ID,
        kind: "early",
        amount_cents: 400000,
        reason: "Venue deposit",
        tournament: { name: "KL Open" },
        organizer: { name: "KL Chess Club" },
        ...overrides,
      },
      error: null,
    },
  ];
}

function givenAdmins(rows: unknown[]) {
  mockRpc.mockResolvedValue({ data: rows, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  mockAlert.mockResolvedValue(undefined);
  mockNomination.mockResolvedValue(undefined);
  mockReview.mockResolvedValue(undefined);
  mockResponse.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("notifyAdminsOfPayout", () => {
  it("emails every platform admin, once per address, linking to the review page", async () => {
    givenPayout();
    givenAdmins([
      { email: "a@x.test", first_name: "Aida" },
      { email: "A@x.test", first_name: "Aida again" },
      { email: "b@x.test", first_name: null },
      { email: null, first_name: "No email" },
    ]);

    await notifyAdminsOfPayout(ID, "early_request");

    expect(mockRpc).toHaveBeenCalledWith("list_global_permission_holders", {
      p_permission: "platform.manage",
    });
    expect(mockAlert).toHaveBeenCalledTimes(2);
    expect(mockAlert).toHaveBeenCalledWith("A@x.test", {
      alert: "early_request",
      recipientName: "Aida again",
      tournamentName: "KL Open",
      organizationName: "KL Chess Club",
      amountCents: 400000,
      detail: "Reason given: Venue deposit",
      path: `/admin/payouts/${ID}`,
    });
    expect(mockAlert).toHaveBeenCalledWith(
      "b@x.test",
      expect.objectContaining({ recipientName: "there" }),
    );
  });

  it("uses the given detail and the queue page for a budget alert", async () => {
    givenPayout({ kind: "automatic", reason: null });
    givenAdmins([{ email: "a@x.test", first_name: "Aida" }]);

    await notifyAdminsOfPayout(ID, "awaiting_budget", "RM 101.00 requested");

    expect(mockAlert).toHaveBeenCalledWith(
      "a@x.test",
      expect.objectContaining({
        alert: "awaiting_budget",
        detail: "RM 101.00 requested",
        path: "/admin/payouts",
      }),
    );
  });

  it("logs and gives up when the payout can't be loaded", async () => {
    tables.payouts = [{ data: null, error: { message: "db down" } }];
    await notifyAdminsOfPayout(ID, "early_request");
    expect(mockAlert).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("failed to load admin alert data"),
      "db down",
    );
  });

  it("never throws when the admin lookup fails", async () => {
    givenPayout();
    mockRpc.mockResolvedValue({ data: null, error: { message: "rpc down" } });
    await expect(notifyAdminsOfPayout(ID, "early_request")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("admin alert failed"),
      "rpc down",
    );
  });

  it("logs, rather than throws, when an email fails", async () => {
    givenPayout();
    givenAdmins([
      { email: "a@x.test", first_name: "Aida" },
      { email: "b@x.test", first_name: "Bala" },
    ]);
    mockAlert.mockRejectedValueOnce(new Error("resend down"));

    await notifyAdminsOfPayout(ID, "early_request");

    expect(mockAlert).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to send 1/2 admin payout alert(s)"),
      ["resend down"],
    );
  });

  it("says so when there is nobody to alert", async () => {
    givenPayout();
    givenAdmins([]);
    await notifyAdminsOfPayout(ID, "early_request");
    expect(mockAlert).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("no platform admins to alert"),
    );
  });
});

describe("notifyBeneficiaryNominated", () => {
  const T_ID = "22222222-2222-2222-2222-222222222222";
  const NOMINEE = "33333333-3333-3333-3333-333333333333";

  function givenNomination() {
    tables.tournaments = [
      { data: { name: "KL Open", organizer: { name: "KL Chess Club" } }, error: null },
    ];
    tables.organizations = [
      // The nominee's name, then its contact address for the recipient list.
      { data: { name: "Selangor Chess" }, error: null },
      { data: [{ name: "Selangor Chess", email: "hello@selangor.test" }], error: null },
    ];
    tables.organization_memberships = [
      {
        data: [
          { user: { email: "owner@selangor.test", first_name: "Siti" }, roles: { name: "owner" } },
          { user: { email: "member@selangor.test", first_name: "Max" }, roles: { name: "member" } },
        ],
        error: null,
      },
    ];
  }

  it("emails the nominee's owners/admins and contact address", async () => {
    givenNomination();
    await notifyBeneficiaryNominated(T_ID, NOMINEE);

    expect(mockNomination).toHaveBeenCalledTimes(2);
    expect(mockNomination).toHaveBeenCalledWith("owner@selangor.test", {
      recipientName: "Siti",
      nomineeOrgId: NOMINEE,
      nomineeName: "Selangor Chess",
      organizerName: "KL Chess Club",
      tournamentName: "KL Open",
    });
    expect(mockNomination).toHaveBeenCalledWith(
      "hello@selangor.test",
      expect.objectContaining({ recipientName: "Selangor Chess" }),
    );
    expect(mockNomination).not.toHaveBeenCalledWith("member@selangor.test", expect.anything());
  });

  it("never throws when the data can't be loaded", async () => {
    tables.tournaments = [{ data: null, error: { message: "db down" } }];
    await expect(notifyBeneficiaryNominated(T_ID, NOMINEE)).resolves.toBeUndefined();
    expect(mockNomination).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("failed to load nomination email data"),
      "db down",
    );
  });
});

describe("notifyNominationResponded", () => {
  const T_ID = "22222222-2222-2222-2222-222222222222";
  const ORGANIZER = "44444444-4444-4444-4444-444444444444";
  const NOMINEE = "33333333-3333-3333-3333-333333333333";

  function givenResponse() {
    tables.tournaments = [
      { data: { name: "KL Open", organization_id: ORGANIZER }, error: null },
    ];
    tables.organizations = [
      // The nominee's name, then the ORGANIZER's contact address.
      { data: { name: "Selangor Chess" }, error: null },
      { data: [{ name: "KL Chess Club", email: "hello@klchess.test" }], error: null },
    ];
    tables.organization_memberships = [
      {
        data: [
          { user: { email: "owner@klchess.test", first_name: "Aisha" }, roles: { name: "owner" } },
          { user: { email: "member@klchess.test", first_name: "Max" }, roles: { name: "member" } },
        ],
        error: null,
      },
    ];
  }

  it.each([true, false])(
    "emails the organizer's owners/admins and contact address (accepted=%s)",
    async (accepted) => {
      givenResponse();
      await notifyNominationResponded(T_ID, NOMINEE, accepted);

      expect(mockResponse).toHaveBeenCalledTimes(2);
      expect(mockResponse).toHaveBeenCalledWith("owner@klchess.test", {
        recipientName: "Aisha",
        organizerOrgId: ORGANIZER,
        tournamentId: T_ID,
        nomineeName: "Selangor Chess",
        tournamentName: "KL Open",
        accepted,
      });
      expect(mockResponse).toHaveBeenCalledWith(
        "hello@klchess.test",
        expect.objectContaining({ recipientName: "KL Chess Club", accepted }),
      );
      expect(mockResponse).not.toHaveBeenCalledWith("member@klchess.test", expect.anything());
    },
  );

  it("never throws when the data can't be loaded", async () => {
    tables.tournaments = [{ data: null, error: { message: "db down" } }];
    await expect(notifyNominationResponded(T_ID, NOMINEE, true)).resolves.toBeUndefined();
    expect(mockResponse).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("failed to load nomination response email data"),
      "db down",
    );
  });

  it("never throws when a send fails", async () => {
    givenResponse();
    mockResponse.mockRejectedValue(new Error("resend down"));
    await expect(notifyNominationResponded(T_ID, NOMINEE, false)).resolves.toBeUndefined();
  });
});

describe("notifyPayoutReviewed", () => {
  function givenReviewed(overrides: Record<string, unknown> = {}) {
    tables.payouts = [
      {
        data: {
          id: ID,
          approval: "rejected",
          amount_cents: 250000,
          rejection_reason: "Send the invoice first",
          organization_id: "org-1",
          tournament: { name: "KL Open" },
          ...overrides,
        },
        error: null,
      },
    ];
    tables.organization_memberships = [
      {
        data: [{ user: { email: "owner@x.test", first_name: "Olivia" }, roles: { name: "owner" } }],
        error: null,
      },
    ];
    tables.organizations = [{ data: [], error: null }];
  }

  it("emails the organizing organization the rejection and its reason", async () => {
    givenReviewed();
    await notifyPayoutReviewed(ID);
    expect(mockReview).toHaveBeenCalledWith("owner@x.test", {
      recipientName: "Olivia",
      tournamentName: "KL Open",
      amountCents: 250000,
      approved: false,
      rejectionReason: "Send the invoice first",
    });
  });

  it("emails an approval", async () => {
    givenReviewed({ approval: "approved", rejection_reason: null });
    await notifyPayoutReviewed(ID);
    expect(mockReview).toHaveBeenCalledWith(
      "owner@x.test",
      expect.objectContaining({ approved: true, rejectionReason: undefined }),
    );
  });

  it("sends nothing for a payout that hasn't been reviewed", async () => {
    givenReviewed({ approval: "pending" });
    await notifyPayoutReviewed(ID);
    expect(mockReview).not.toHaveBeenCalled();
  });
});
