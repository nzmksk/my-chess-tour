import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, tables, mockReview } = vi.hoisted(() => {
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
    mockReview: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("@/services/email/email", () => ({
  sendOkuReviewEmail: mockReview,
}));

import { notifyOkuReviewed } from "../notify";

const USER = "33333333-3333-3333-3333-333333333333";

function givenProfile(overrides: Record<string, unknown> = {}) {
  tables.player_profiles = [
    {
      data: {
        oku_status: "verified",
        oku_rejection_reason: null,
        user: { email: "farid@example.com", first_name: "Farid" },
        ...overrides,
      },
      error: null,
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  mockReview.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("notifyOkuReviewed", () => {
  it("emails the player that they are verified", async () => {
    givenProfile();
    await notifyOkuReviewed(USER);
    expect(mockReview).toHaveBeenCalledWith("farid@example.com", {
      recipientName: "Farid",
      verified: true,
      rejectionReason: undefined,
    });
  });

  it("passes the reason on a rejection", async () => {
    givenProfile({ oku_status: "rejected", oku_rejection_reason: "Blurry scan" });
    await notifyOkuReviewed(USER);
    expect(mockReview).toHaveBeenCalledWith("farid@example.com", {
      recipientName: "Farid",
      verified: false,
      rejectionReason: "Blurry scan",
    });
  });

  it.each(["pending", "none"])("sends nothing while the status is %s", async (status) => {
    givenProfile({ oku_status: status });
    await notifyOkuReviewed(USER);
    expect(mockReview).not.toHaveBeenCalled();
  });

  it("sends nothing when the player has no email address", async () => {
    givenProfile({ user: { email: null, first_name: "Farid" } });
    await notifyOkuReviewed(USER);
    expect(mockReview).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("logs and returns when the profile can't be loaded", async () => {
    tables.player_profiles = [{ data: null, error: { message: "boom" } }];
    await expect(notifyOkuReviewed(USER)).resolves.toBeUndefined();
    expect(mockReview).not.toHaveBeenCalled();
  });

  it("never throws when the send fails", async () => {
    givenProfile();
    mockReview.mockRejectedValue(new Error("resend down"));
    await expect(notifyOkuReviewed(USER)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
