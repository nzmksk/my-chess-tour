// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import MembersClient from "../MembersClient";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const ORG_ID = "bbbbbbbb-0000-4000-8000-000000000001";

const OWNER = {
  user_id: "u-1",
  email: "owner@example.com",
  first_name: "Olive",
  last_name: "Owner",
  avatar_url: null,
  role: "owner",
  joined_at: "2026-01-01T00:00:00Z",
};

function renderMembers(
  props: Partial<React.ComponentProps<typeof MembersClient>> = {},
) {
  render(
    <MembersClient
      orgId={ORG_ID}
      orgName="Test Organization"
      members={[OWNER]}
      currentUserId="u-1"
      {...props}
    />,
  );
}

function invite(email: string, role: "admin" | "member") {
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText("Role"), { target: { value: role } });
  fireEvent.click(screen.getByRole("button", { name: "Send Invite" }));
}

function respondWith(data: Record<string, unknown>) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data }),
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const PENDING = {
  id: "inv-1",
  email: "pending@example.com",
  role: "member",
  invited_at: "2026-11-01T00:00:00Z",
  expires_at: "2026-12-01T00:00:00Z",
  days_left: 14,
  expired: false,
  invited_by: "Olive Owner",
};

function inviteResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-new",
    email: "new@example.com",
    role: "admin",
    status: "pending",
    invited_at: "2026-11-17T00:00:00Z",
    expires_at: "2026-12-17T00:00:00Z",
    days_left: 30,
    resent: false,
    email_sent: true,
    ...overrides,
  };
}

describe("MembersClient invite", () => {
  it("sends the invitation and lists it as pending", async () => {
    respondWith(inviteResponse());
    renderMembers();
    invite("new@example.com", "admin");

    expect(await screen.findByText("Invitation sent to new@example.com")).toBeTruthy();
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      email: "new@example.com",
      role: "admin",
    });
    expect(screen.getByText("Pending Invitations · 1")).toBeTruthy();
    expect(screen.getByText("Expires in 30 days", { exact: false })).toBeTruthy();
  });

  it("says when an invitation was re-sent", async () => {
    respondWith(inviteResponse({ resent: true }));
    renderMembers();
    invite("new@example.com", "admin");

    expect(await screen.findByText("Invitation re-sent to new@example.com")).toBeTruthy();
  });

  it("warns when the invitation email couldn't be sent", async () => {
    respondWith(inviteResponse({ email_sent: false }));
    renderMembers();
    invite("new@example.com", "admin");

    expect(
      await screen.findByText(
        "Invitation saved for new@example.com, but the email couldn't be sent. Use Resend below to try again.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Invitation sent to new@example.com")).toBeNull();
  });

  it("shows the API's message when the invite is refused", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: { code: "CONFLICT", message: "User is already a member of this organization" },
      }),
    });
    renderMembers();
    invite("owner@example.com", "member");

    expect(
      await screen.findByText("User is already a member of this organization"),
    ).toBeTruthy();
  });
});

describe("MembersClient pending invitations", () => {
  it("lists pending invitations with who sent them and when they expire", () => {
    renderMembers({ invitations: [PENDING, { ...PENDING, id: "inv-2", email: "late@example.com", expired: true, days_left: 0 }] });
    expect(screen.getByText("Pending Invitations · 2")).toBeTruthy();
    expect(screen.getByText("pending@example.com")).toBeTruthy();
    expect(screen.getAllByText(/by Olive Owner/, { selector: "p" })).toHaveLength(2);
    expect(screen.getByText("Expires in 14 days")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
  });

  it("resends by inviting the same address and role again", async () => {
    respondWith(inviteResponse({ id: "inv-1", email: "pending@example.com", role: "member", resent: true }));
    renderMembers({ invitations: [{ ...PENDING, expired: true, days_left: 0 }] });

    fireEvent.click(screen.getByRole("button", { name: "Resend" }));

    expect(await screen.findByText("Expires in 30 days")).toBeTruthy();
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      email: "pending@example.com",
      role: "member",
    });
    expect(screen.queryByText("Expired")).toBeNull();
  });

  it("revokes an invitation and drops it from the list", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) });
    renderMembers({ invitations: [PENDING] });

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(screen.queryByText("pending@example.com")).toBeNull());
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/v1/organizations/${ORG_ID}/invitations/inv-1`,
      { method: "DELETE" },
    );
  });

  it("keeps the invitation and says why when revoking fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { message: "This invitation is no longer open" } }),
    });
    renderMembers({ invitations: [PENDING] });

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    expect(await screen.findByText("This invitation is no longer open")).toBeTruthy();
    expect(screen.getByText("pending@example.com")).toBeTruthy();
  });

  it("isn't shown to someone who can't invite", () => {
    render(
      <MembersClient
        orgId={ORG_ID}
        orgName="Test Organization"
        members={[OWNER, { ...OWNER, user_id: "u-2", email: "m@example.com", role: "member" }]}
        invitations={[PENDING]}
        currentUserId="u-2"
      />,
    );
    expect(screen.queryByText(/Pending Invitations/)).toBeNull();
  });
});
