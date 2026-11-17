import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, tables, mockReview, mockInvitation, mockResponse } = vi.hoisted(() => {
  const tables: Record<string, Array<{ data: unknown; error: unknown }>> = {};

  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "single", "maybeSingle"]) {
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
    mockInvitation: vi.fn(),
    mockResponse: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("@/services/email/email", () => ({
  sendOrganizerApplicationReviewEmail: mockReview,
  sendMemberInvitationEmail: mockInvitation,
  sendInvitationResponseEmail: mockResponse,
}));

import {
  notifyApplicationReviewed,
  notifyInvitationResponded,
  notifyMemberInvited,
} from "../notify";

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
  mockInvitation.mockResolvedValue(undefined);
  mockResponse.mockResolvedValue(undefined);
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

describe("notifyMemberInvited", () => {
  const INVITER = "aaaaaaaa-0000-0000-0000-000000000001";
  const URL = "https://example.com/invitations/tok";

  function givenData(
    inviter: Record<string, unknown> | null = { first_name: "Aisha", last_name: "Rahman" },
    recipient: Record<string, unknown> | null = { first_name: "Farid" },
  ) {
    tables.organizations = [{ data: { name: "KL Chess Club" }, error: null }];
    // Promise.all starts the inviter lookup before the recipient's.
    tables.users = [
      { data: inviter, error: null },
      { data: recipient, error: null },
    ];
  }

  const invite = (extra: Record<string, unknown> = {}) =>
    notifyMemberInvited({
      orgId: ORG,
      inviterId: INVITER,
      email: "farid@example.com",
      role: "member",
      invitationUrl: URL,
      ...extra,
    });

  it("emails the invitation, naming the inviter and the organization", async () => {
    givenData();
    await expect(invite()).resolves.toBe(true);

    expect(mockInvitation).toHaveBeenCalledWith("farid@example.com", {
      recipientName: "Farid",
      inviterName: "Aisha Rahman",
      organizationName: "KL Chess Club",
      role: "member",
      invitationUrl: URL,
    });
  });

  it("greets an address with no account generically", async () => {
    givenData(undefined, null);
    await invite({ email: "new@example.com", role: "admin" });

    expect(mockInvitation).toHaveBeenCalledWith(
      "new@example.com",
      expect.objectContaining({ recipientName: "there", role: "admin" }),
    );
  });

  it("falls back when the inviter has no name on file", async () => {
    givenData({ first_name: "", last_name: "" });
    await invite();

    expect(mockInvitation).toHaveBeenCalledWith(
      "farid@example.com",
      expect.objectContaining({ inviterName: "A teammate" }),
    );
  });

  it("returns false and sends nothing when the data can't be loaded", async () => {
    tables.organizations = [{ data: null, error: { message: "boom" } }];
    await expect(invite()).resolves.toBe(false);
    expect(mockInvitation).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("never throws when the send fails", async () => {
    givenData();
    mockInvitation.mockRejectedValue(new Error("resend down"));
    await expect(invite()).resolves.toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});

describe("notifyInvitationResponded", () => {
  const INVITATION = "eeeeeeee-0000-0000-0000-000000000001";

  function givenInvitation(overrides: Record<string, unknown> = {}) {
    tables.organization_invitations = [
      {
        data: {
          id: INVITATION,
          email: "farid@example.com",
          status: "accepted",
          organization_id: ORG,
          roles: { name: "admin" },
          organizations: { name: "KL Chess Club" },
          inviter: { email: "aisha@example.com", first_name: "Aisha", deleted_at: null },
          responder: { first_name: "Farid", last_name: "Ali" },
          ...overrides,
        },
        error: null,
      },
    ];
  }

  it("tells the inviter who accepted, as what", async () => {
    givenInvitation();
    await notifyInvitationResponded(INVITATION);

    expect(mockResponse).toHaveBeenCalledWith("aisha@example.com", {
      recipientName: "Aisha",
      inviteeName: "Farid Ali",
      inviteeEmail: "farid@example.com",
      organizationName: "KL Chess Club",
      orgId: ORG,
      role: "admin",
      accepted: true,
    });
  });

  it("names a decliner without an account by their address", async () => {
    givenInvitation({ status: "declined", responder: null });
    await notifyInvitationResponded(INVITATION);

    expect(mockResponse).toHaveBeenCalledWith(
      "aisha@example.com",
      expect.objectContaining({ inviteeName: "farid@example.com", accepted: false }),
    );
  });

  it("sends nothing for an invitation that wasn't answered", async () => {
    givenInvitation({ status: "revoked" });
    await notifyInvitationResponded(INVITATION);
    expect(mockResponse).not.toHaveBeenCalled();
  });

  it("sends nothing when the inviter's account is gone", async () => {
    givenInvitation({ inviter: null });
    await notifyInvitationResponded(INVITATION);
    givenInvitation({
      inviter: { email: "aisha@example.com", first_name: "Aisha", deleted_at: "2026-01-01" },
    });
    await notifyInvitationResponded(INVITATION);
    expect(mockResponse).not.toHaveBeenCalled();
  });

  it("logs and returns when the invitation can't be loaded", async () => {
    tables.organization_invitations = [{ data: null, error: { message: "boom" } }];
    await expect(notifyInvitationResponded(INVITATION)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("never throws when the send fails", async () => {
    givenInvitation();
    mockResponse.mockRejectedValue(new Error("resend down"));
    await expect(notifyInvitationResponded(INVITATION)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
