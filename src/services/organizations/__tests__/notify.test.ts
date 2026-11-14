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
  sendOrganizerApplicationReviewEmail: mockReview,
}));

import { notifyApplicationReviewed } from "../notify";

const ORG = "22222222-2222-2222-2222-222222222222";

function givenOrg(overrides: Record<string, unknown> = {}) {
  tables.organizations = [
    {
      data: {
        id: ORG,
        name: "KL Chess Club",
        email: "club@example.com",
        approval_status: "approved",
        rejection_reason: null,
        applicant: { email: "aisha@example.com", first_name: "Aisha" },
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

describe("notifyApplicationReviewed", () => {
  it("emails the applicant and the contact address on approval", async () => {
    givenOrg();
    await notifyApplicationReviewed(ORG);

    expect(mockReview).toHaveBeenCalledTimes(2);
    expect(mockReview).toHaveBeenCalledWith("aisha@example.com", {
      recipientName: "Aisha",
      organizationName: "KL Chess Club",
      orgId: ORG,
      approved: true,
      rejectionReason: undefined,
    });
    expect(mockReview).toHaveBeenCalledWith(
      "club@example.com",
      expect.objectContaining({ recipientName: "KL Chess Club", approved: true }),
    );
  });

  it("passes the reason on a rejection", async () => {
    givenOrg({ approval_status: "rejected", rejection_reason: "Missing SSM document" });
    await notifyApplicationReviewed(ORG);

    expect(mockReview).toHaveBeenCalledWith(
      "aisha@example.com",
      expect.objectContaining({ approved: false, rejectionReason: "Missing SSM document" }),
    );
  });

  it("emails an address shared by applicant and contact once, by the applicant's name", async () => {
    givenOrg({ email: "AISHA@example.com" });
    await notifyApplicationReviewed(ORG);

    expect(mockReview).toHaveBeenCalledOnce();
    expect(mockReview).toHaveBeenCalledWith(
      "aisha@example.com",
      expect.objectContaining({ recipientName: "Aisha" }),
    );
  });

  it("sends nothing for an application still pending", async () => {
    givenOrg({ approval_status: "pending" });
    await notifyApplicationReviewed(ORG);
    expect(mockReview).not.toHaveBeenCalled();
  });

  it("logs and returns when the organization can't be loaded", async () => {
    tables.organizations = [{ data: null, error: { message: "boom" } }];
    await expect(notifyApplicationReviewed(ORG)).resolves.toBeUndefined();
    expect(mockReview).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("never throws when a send fails", async () => {
    givenOrg();
    mockReview.mockRejectedValue(new Error("resend down"));
    await expect(notifyApplicationReviewed(ORG)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
