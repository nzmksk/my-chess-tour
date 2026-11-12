import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, mockRpc, tables, mockAlert, mockNomination } = vi.hoisted(() => {
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
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));

vi.mock("@/services/email/email", () => ({
  sendAdminPayoutAlertEmail: mockAlert,
  sendBeneficiaryNominationEmail: mockNomination,
}));

import { notifyAdminsOfPayout, notifyBeneficiaryNominated } from "../notify";

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
